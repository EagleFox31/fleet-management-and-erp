-- =============================================================================
-- SUPPLIER INVOICE SETTLEMENTS WORKFLOW
-- - Trigger: keeps supplier_invoices financial fields consistent
-- - Views: operational and accounting reporting
-- - Window function view: running settlement ledger
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Core recalculation function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_supplier_invoice_financials(p_invoice_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_total_ttc NUMERIC := 0;
  v_current_status TEXT;
  v_reconciled_total NUMERIC := 0;
  v_recorded_total NUMERIC := 0;
  v_balance NUMERIC := 0;
  v_is_complete BOOLEAN := FALSE;
  v_last_payment_date DATE;
  v_last_payment_method TEXT;
BEGIN
  SELECT
    COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC,
    si.status
  INTO v_total_ttc, v_current_status
  FROM supplier_invoices si
  WHERE si.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN s.status = 'reconciled' THEN s.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN s.status IN ('recorded', 'reconciled') THEN s.amount ELSE 0 END), 0),
    MAX(CASE WHEN s.status = 'reconciled' THEN s.payment_date END)
  INTO v_reconciled_total, v_recorded_total, v_last_payment_date
  FROM supplier_invoice_settlements s
  WHERE s.supplier_invoice_id = p_invoice_id;

  SELECT x.payment_method
  INTO v_last_payment_method
  FROM supplier_invoice_settlements x
  WHERE x.supplier_invoice_id = p_invoice_id
    AND x.status = 'reconciled'
  ORDER BY x.payment_date DESC NULLS LAST, x.id DESC
  LIMIT 1;

  v_balance := GREATEST(v_total_ttc - v_reconciled_total, 0);
  v_is_complete := v_balance <= 0.00001;

  UPDATE supplier_invoices
  SET
    balance = ROUND(v_balance, 2),
    is_payment_complete = v_is_complete,
    status = CASE
      WHEN status = 'disputed' THEN status
      WHEN v_is_complete THEN 'paid'
      WHEN status = 'paid' THEN 'approved'
      ELSE status
    END,
    paid_date = CASE
      WHEN v_is_complete THEN COALESCE(v_last_payment_date, paid_date)
      ELSE NULL
    END,
    payment_date = CASE
      WHEN v_is_complete THEN COALESCE(v_last_payment_date, payment_date)
      ELSE NULL
    END,
    payment_method = CASE
      WHEN v_is_complete THEN COALESCE(v_last_payment_method, payment_method)
      ELSE payment_method
    END,
    updated_at = NOW()
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2) Trigger function (settlements -> invoice sync)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_recalc_supplier_invoice_financials()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id INTEGER;
BEGIN
  v_invoice_id := COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id);
  PERFORM recalc_supplier_invoice_financials(v_invoice_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoice_settlements_recalc ON supplier_invoice_settlements;

CREATE TRIGGER trg_supplier_invoice_settlements_recalc
AFTER INSERT OR UPDATE OR DELETE
ON supplier_invoice_settlements
FOR EACH ROW
EXECUTE FUNCTION trigger_recalc_supplier_invoice_financials();

-- Optional safety net when invoice total changes manually
CREATE OR REPLACE FUNCTION trigger_recalc_on_supplier_invoice_amount_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_supplier_invoice_financials(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoice_amount_change_recalc ON supplier_invoices;

CREATE TRIGGER trg_supplier_invoice_amount_change_recalc
AFTER UPDATE OF total_ttc, total_amount
ON supplier_invoices
FOR EACH ROW
EXECUTE FUNCTION trigger_recalc_on_supplier_invoice_amount_change();

-- -----------------------------------------------------------------------------
-- 3) Views for reporting
-- -----------------------------------------------------------------------------

-- Global summary per supplier invoice
CREATE OR REPLACE VIEW v_supplier_invoice_payment_summary AS
SELECT
  si.id AS invoice_id,
  si.invoice_number,
  si.supplier_id,
  sp.name AS supplier_name,
  si.status,
  si.invoice_date,
  si.due_date,
  COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC(15,2) AS total_ttc,
  COALESCE(
    SUM(CASE WHEN sis.status = 'recorded' THEN sis.amount ELSE 0 END),
    0
  )::NUMERIC(15,2) AS recorded_amount,
  COALESCE(
    SUM(CASE WHEN sis.status = 'reconciled' THEN sis.amount ELSE 0 END),
    0
  )::NUMERIC(15,2) AS reconciled_amount,
  COALESCE(
    SUM(CASE WHEN sis.status = 'recorded' THEN sis.amount ELSE 0 END),
    0
  )::NUMERIC(15,2) AS pending_reconciliation_amount,
  GREATEST(
    COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC
    - COALESCE(SUM(CASE WHEN sis.status = 'reconciled' THEN sis.amount ELSE 0 END), 0)::NUMERIC,
    0
  )::NUMERIC(15,2) AS remaining_balance,
  CASE
    WHEN COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC <= 0 THEN 0
    ELSE ROUND(
      (
        COALESCE(SUM(CASE WHEN sis.status = 'reconciled' THEN sis.amount ELSE 0 END), 0)::NUMERIC
        / COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC
      ) * 100,
      2
    )
  END AS settlement_progress_percent,
  COUNT(sis.id)::INTEGER AS settlements_count,
  MAX(sis.payment_date) AS last_settlement_date,
  MAX(CASE WHEN sis.status = 'reconciled' THEN sis.payment_date END) AS last_reconciled_date
FROM supplier_invoices si
LEFT JOIN suppliers sp ON sp.id = si.supplier_id
LEFT JOIN supplier_invoice_settlements sis ON sis.supplier_invoice_id = si.id
GROUP BY
  si.id, si.invoice_number, si.supplier_id, sp.name, si.status, si.invoice_date, si.due_date,
  si.total_ttc, si.total_amount;

-- Queue of settlements waiting for reconciliation
CREATE OR REPLACE VIEW v_supplier_settlements_to_reconcile AS
SELECT
  sis.id AS settlement_id,
  sis.supplier_invoice_id AS invoice_id,
  si.invoice_number,
  sp.name AS supplier_name,
  sis.amount::NUMERIC(15,2) AS amount,
  sis.payment_method,
  sis.payment_reference,
  sis.payment_date,
  sis.value_date,
  sis.treasury_account,
  sis.proof_reference,
  sis.notes,
  sis.recorded_by,
  u.name AS recorded_by_name,
  sis.created_at,
  GREATEST((CURRENT_DATE - sis.payment_date), 0)::INTEGER AS days_since_payment
FROM supplier_invoice_settlements sis
JOIN supplier_invoices si ON si.id = sis.supplier_invoice_id
LEFT JOIN suppliers sp ON sp.id = si.supplier_id
LEFT JOIN users u ON u.id = sis.recorded_by
WHERE sis.status = 'recorded'
ORDER BY sis.payment_date ASC, sis.id ASC;

-- -----------------------------------------------------------------------------
-- 4) Window function view: running ledger per invoice
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_supplier_invoice_settlement_ledger AS
WITH base AS (
  SELECT
    sis.id AS settlement_id,
    sis.supplier_invoice_id AS invoice_id,
    si.invoice_number,
    sp.name AS supplier_name,
    COALESCE(si.total_ttc, si.total_amount, 0)::NUMERIC(15,2) AS invoice_total_ttc,
    sis.payment_date,
    sis.value_date,
    sis.amount::NUMERIC(15,2) AS amount,
    sis.status,
    sis.payment_method,
    sis.payment_reference,
    sis.recorded_by,
    ru.name AS recorded_by_name,
    sis.reconciled_by,
    cu.name AS reconciled_by_name,
    sis.reconciled_at,
    sis.created_at,
    CASE WHEN sis.status = 'reconciled' THEN sis.amount::NUMERIC(15,2) ELSE 0::NUMERIC(15,2) END AS reconciled_amount_line
  FROM supplier_invoice_settlements sis
  JOIN supplier_invoices si ON si.id = sis.supplier_invoice_id
  LEFT JOIN suppliers sp ON sp.id = si.supplier_id
  LEFT JOIN users ru ON ru.id = sis.recorded_by
  LEFT JOIN users cu ON cu.id = sis.reconciled_by
)
SELECT
  b.*,
  SUM(b.reconciled_amount_line) OVER (
    PARTITION BY b.invoice_id
    ORDER BY b.payment_date ASC, b.settlement_id ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )::NUMERIC(15,2) AS running_reconciled_amount,
  GREATEST(
    b.invoice_total_ttc
    - SUM(b.reconciled_amount_line) OVER (
      PARTITION BY b.invoice_id
      ORDER BY b.payment_date ASC, b.settlement_id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ),
    0
  )::NUMERIC(15,2) AS running_balance_after
FROM base b
ORDER BY b.invoice_id, b.payment_date, b.settlement_id;

