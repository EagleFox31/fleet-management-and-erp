-- Retrait du cache dashboard Direction (plancher réseau Neon, pas volume SQL).
-- Conserve uniquement les index de dates — voir init-database.ts applyPerformanceIndexes.

DROP TRIGGER IF EXISTS trg_management_cache_client_invoices_ins ON client_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_client_invoices_upd ON client_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_client_invoices_del ON client_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_fuel_records_ins ON fuel_records;
DROP TRIGGER IF EXISTS trg_management_cache_fuel_records_upd ON fuel_records;
DROP TRIGGER IF EXISTS trg_management_cache_fuel_records_del ON fuel_records;
DROP TRIGGER IF EXISTS trg_management_cache_work_orders_ins ON work_orders;
DROP TRIGGER IF EXISTS trg_management_cache_work_orders_upd ON work_orders;
DROP TRIGGER IF EXISTS trg_management_cache_work_orders_del ON work_orders;
DROP TRIGGER IF EXISTS trg_management_cache_supplier_invoices_ins ON supplier_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_supplier_invoices_upd ON supplier_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_supplier_invoices_del ON supplier_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_missions_ins ON missions;
DROP TRIGGER IF EXISTS trg_management_cache_missions_upd ON missions;
DROP TRIGGER IF EXISTS trg_management_cache_missions_del ON missions;

DROP TRIGGER IF EXISTS trg_management_cache_client_invoices ON client_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_fuel_records ON fuel_records;
DROP TRIGGER IF EXISTS trg_management_cache_work_orders ON work_orders;
DROP TRIGGER IF EXISTS trg_management_cache_supplier_invoices ON supplier_invoices;
DROP TRIGGER IF EXISTS trg_management_cache_missions ON missions;

DROP FUNCTION IF EXISTS management_trigger_refresh_client_invoices_insert_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_client_invoices_update_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_client_invoices_delete_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_fuel_records_insert_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_fuel_records_update_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_fuel_records_delete_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_work_orders_insert_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_work_orders_update_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_work_orders_delete_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_supplier_invoices_insert_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_supplier_invoices_update_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_supplier_invoices_delete_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_missions_insert_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_missions_update_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_missions_delete_stmt();
DROP FUNCTION IF EXISTS management_trigger_refresh_client_invoice();
DROP FUNCTION IF EXISTS management_trigger_refresh_fuel_record();
DROP FUNCTION IF EXISTS management_trigger_refresh_work_order();
DROP FUNCTION IF EXISTS management_trigger_refresh_supplier_invoice();
DROP FUNCTION IF EXISTS management_trigger_refresh_mission();
DROP FUNCTION IF EXISTS management_trigger_refresh_date();
DROP FUNCTION IF EXISTS management_refresh_distinct_dates(DATE[]);

DROP VIEW IF EXISTS management_v_daily_summary;

DROP TABLE IF EXISTS management_cargo_daily;
DROP TABLE IF EXISTS management_destination_daily;
DROP TABLE IF EXISTS management_client_daily;
DROP TABLE IF EXISTS management_daily_metrics;

DROP FUNCTION IF EXISTS management_refresh_daily_metrics(DATE);
DROP FUNCTION IF EXISTS management_extract_cargo_label(JSONB);

CREATE INDEX IF NOT EXISTS idx_client_invoices_invoice_date_status
  ON client_invoices (invoice_date, status);

CREATE INDEX IF NOT EXISTS idx_fuel_records_date
  ON fuel_records (date);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_invoice_date_status
  ON supplier_invoices (invoice_date, status);

CREATE INDEX IF NOT EXISTS idx_missions_delivery_date_status
  ON missions (delivery_date, status);

CREATE INDEX IF NOT EXISTS idx_work_orders_completed_created_at
  ON work_orders (status, created_at)
  WHERE status = 'completed';
