-- Verrou d'argent des factures émises, version avec avoirs (lot V1, PR5) : remplace la fonction posée par
-- 20261110_money_lock_invoices.sql (PR4) en ouvrant credited_amount_ttc. Règle : seulement à la hausse, au plus
-- égale à amount_ttc, jamais sur une facture annulée. Tout le reste (liste blanche, solde, dépôt, annulée terminale,
-- TRUNCATE, levée withMoneyOverride) est repris à l'identique de PR4. Ajout : cohérence statut et solde (payée = solde nul).
-- Ordre de rejeu : les migrations sont triées par nom, ce fichier passe APRÈS 20261110_client_credit_notes.sql (qui
-- ajoute la colonne) et APRÈS 20261110_money_lock_invoices.sql (dont il remplace la fonction) ; rejouées dans
-- l'autre ordre, la règle des avoirs serait absente : garde de tri dans tests/unit/server/client-credit-notes-schema.test.ts.
-- Même SQL que CLIENT_INVOICES_ISSUED_LOCK_SQL (server/init-database.ts, AGENTS.md §5), comparé par
-- tests/unit/server/client-invoices-lock-schema.test.ts. Aucune donnée modifiée. Idempotent.
-- Retour arrière : rejouer la fonction de 20261110_money_lock_invoices.sql (CREATE OR REPLACE) après avoir retiré ce fichier.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_client_invoices_issued_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- Liste blanche : toute autre colonne (montants, TVA, lignes, client, mission, numéro, dates, notes, auteur...)
  -- est gelée, y compris une colonne ajoutée plus tard, qui naît gelée.
  -- credited_amount_ttc (avoirs, PR5) : libre ici, bornée par sa règle plus bas.
  free_cols text[] := ARRAY['status', 'balance', 'updated_at', 'credited_amount_ttc',
    'deposited_at', 'withholding_vat_amount', 'withholding_is_amount', 'net_payable', 'deposited_by'];
BEGIN
  -- Levée explicite pour la transaction en cours : rien à garder.
  IF current_setting('fleetos.allow_money_override', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Facture émise : suppression refusée.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  IF (to_jsonb(NEW) - free_cols) IS DISTINCT FROM (to_jsonb(OLD) - free_cols) THEN
    RAISE EXCEPTION 'Facture émise : montants, lignes, client, mission, numéro et dates ne se modifient plus.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Annulée : statut terminal, aucune sortie et aucun mouvement de solde (décision e de 0a).
  IF OLD.status = 'cancelled'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.balance IS DISTINCT FROM OLD.balance
          OR NEW.credited_amount_ttc IS DISTINCT FROM OLD.credited_amount_ttc) THEN
    RAISE EXCEPTION 'Facture annulée : statut terminal, ni sortie ni modification de montant.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Solde : il ne fait que baisser (paiements), jamais sous zéro. Une hausse rouvrirait une facture payée ;
  -- un solde déjà hors bornes (donnée ancienne) n'empêche pas de changer le statut tant qu'il ne bouge pas.
  IF NEW.balance IS DISTINCT FROM OLD.balance AND (NEW.balance > OLD.balance OR NEW.balance < 0) THEN
    RAISE EXCEPTION 'Facture émise : le solde ne fait que baisser, sans passer sous zéro.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Cohérence statut et solde (décision de 0a) : payée = solde nul. Une facture payée ne se rouvre pas ; on ne passe
  -- à payée qu'à solde zéro ; un solde zéro impose payée (sauf annulée). Contrôlé quand le statut ou le solde bouge.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.balance IS DISTINCT FROM OLD.balance THEN
    IF OLD.status = 'paid' AND NEW.status IN ('pending', 'partial', 'overdue') THEN
      RAISE EXCEPTION 'Facture payée : elle ne repasse pas en attente, partielle ou en retard.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
    END IF;
    IF NEW.status = 'paid' AND NEW.balance <> 0 THEN
      RAISE EXCEPTION 'Facture émise : le statut payée exige un solde nul.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
    END IF;
    IF NEW.balance = 0 AND NEW.status NOT IN ('paid', 'cancelled') THEN
      RAISE EXCEPTION 'Facture émise : un solde nul impose le statut payée.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
    END IF;
  END IF;

  -- Avoirs (PR5) : le cumul crédité ne fait que monter, et ne dépasse jamais le TTC (un avoir ne rend pas d'argent).
  IF NEW.credited_amount_ttc IS DISTINCT FROM OLD.credited_amount_ttc
     AND (NEW.credited_amount_ttc < OLD.credited_amount_ttc OR NEW.credited_amount_ttc > NEW.amount_ttc) THEN
    RAISE EXCEPTION 'Facture émise : le cumul des avoirs ne fait que monter, sans dépasser le TTC.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Dépôt. Seul détachement permis après coup : deposited_by vers NULL par l'action de clé étrangère (suppression de
  -- l'utilisateur ; UPDATE lancé par un trigger, profondeur > 1). pg_trigger_depth() > 1 couvre tout UPDATE émis
  -- depuis un trigger : aujourd'hui seule cette action ON DELETE SET NULL écrit client_invoices ainsi ; un futur
  -- trigger qui viderait deposited_by passerait aussi.
  IF NEW.deposited_by IS NULL AND OLD.deposited_by IS NOT NULL AND pg_trigger_depth() > 1
     AND (NEW.deposited_at, NEW.withholding_vat_amount, NEW.withholding_is_amount, NEW.net_payable)
         IS NOT DISTINCT FROM (OLD.deposited_at, OLD.withholding_vat_amount, OLD.withholding_is_amount, OLD.net_payable) THEN
    RETURN NEW;
  END IF;
  -- Sinon le dépôt se pose une seule fois, avec sa date et son auteur, sur une facture en attente de paiement
  -- avant comme après l'UPDATE (ni payée ni annulée, comme finance-receivables-service.depositInvoice).
  IF (NEW.deposited_at, NEW.withholding_vat_amount, NEW.withholding_is_amount, NEW.net_payable, NEW.deposited_by)
       IS DISTINCT FROM (OLD.deposited_at, OLD.withholding_vat_amount, OLD.withholding_is_amount, OLD.net_payable, OLD.deposited_by) THEN
    IF OLD.deposited_at IS NOT NULL OR OLD.status = 'cancelled' OR NEW.status = 'cancelled'
       OR OLD.status = 'paid' OR NEW.status = 'paid'
       OR NEW.deposited_at IS NULL OR NEW.deposited_by IS NULL THEN
      RAISE EXCEPTION 'Facture émise : le dépôt se pose une seule fois, avec sa date et son auteur.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Vider la table effacerait aussi les factures émises, sans passer par le trigger par ligne.
CREATE OR REPLACE FUNCTION fn_client_invoices_truncate_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('fleetos.allow_money_override', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Factures clients : vidage de la table refusé.'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
END;
$$;

-- Poser un trigger prend un verrou SHARE ROW EXCLUSIVE sur client_invoices : borné par lock_timeout, l'échec est toléré.
DO $do$
BEGIN
  CREATE OR REPLACE TRIGGER trg_client_invoices_issued_lock
  BEFORE UPDATE OR DELETE ON client_invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_client_invoices_issued_lock();

  CREATE OR REPLACE TRIGGER trg_client_invoices_truncate_lock
  BEFORE TRUNCATE ON client_invoices
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_client_invoices_truncate_lock();
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'triggers de verrou des factures non posés : verrou de table indisponible, nouvel essai au démarrage suivant';
END $do$;
