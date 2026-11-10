-- Verrou d'argent en base (lot V1, D2) : une facture client est émise dès sa création (pas de brouillon), elle ne se
-- modifie plus et ne se supprime plus, quel que soit l'appelant (route, script, SQL direct). Refus : check_violation,
-- contrainte client_invoices_issued_locked, traduite en 409 lisible par server/lib/pg-errors.ts (moneyLockMessageOf).
-- Liste blanche : status, balance, updated_at (retard, paiement) ; dépôt (deposited_at, withholding_vat_amount,
-- withholding_is_amount, net_payable, deposited_by) une seule fois, de « non déposée » vers une date et un auteur,
-- sur une facture ni payée ni annulée ; solde en baisse seulement, jamais négatif ;
-- deposited_by vers NULL seulement par l'action de clé étrangère (ON DELETE SET NULL d'un utilisateur supprimé,
-- pg_trigger_depth() > 1). Une facture annulée (cancelled) est terminale : ni sortie, ni montant, ni dépôt.
-- mission_id, client_id et created_by sont en NO ACTION : la clé étrangère refuse déjà la suppression d'une mission,
-- d'un client ou d'un auteur qui porte une facture ; le trigger ne leur ouvre rien.
-- TRUNCATE de la table refusé (trigger par instruction, déclenché aussi par un TRUNCATE ... CASCADE en amont).
-- Levée pour une seule transaction : withMoneyOverride (AGENTS.md §5).
-- Verrou de table borné à 5 s (lock_timeout) : si une écriture longue le retient, les triggers ne sont pas posés,
-- un WARNING est émis, init-database le journalise, et le démarrage suivant réessaie.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- CLIENT_INVOICES_ISSUED_LOCK_SQL (AGENTS.md §5), comparé par tests/unit/server/client-invoices-lock-schema.test.ts.
-- Aucune donnée modifiée : les factures existantes deviennent simplement protégées. Idempotent.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant repose le trigger) :
--   1. retirer CLIENT_INVOICES_ISSUED_LOCK_SQL et son appel de server/init-database.ts, puis ce fichier ;
--   2. DROP TRIGGER IF EXISTS trg_client_invoices_issued_lock ON client_invoices; DROP FUNCTION IF EXISTS fn_client_invoices_issued_lock();
--      DROP TRIGGER IF EXISTS trg_client_invoices_truncate_lock ON client_invoices; DROP FUNCTION IF EXISTS fn_client_invoices_truncate_lock();
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_client_invoices_issued_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- Liste blanche : toute autre colonne (montants, TVA, lignes, client, mission, numéro, dates, notes, auteur...)
  -- est gelée, y compris une colonne ajoutée plus tard, qui naît gelée.
  -- Avoirs (lot V1, PR5) : ajouter 'credited_amount_ttc' à ce tableau, et sa règle (à la hausse seulement, au plus
  -- le TTC) à l'emplacement marqué plus bas ; le reste de la logique ne change pas.
  free_cols text[] := ARRAY['status', 'balance', 'updated_at',
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
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.balance IS DISTINCT FROM OLD.balance) THEN
    RAISE EXCEPTION 'Facture annulée : statut terminal, ni sortie ni modification de montant.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Solde : il ne fait que baisser (paiements), jamais sous zéro. Une hausse rouvrirait une facture payée ;
  -- un solde déjà hors bornes (donnée ancienne) n'empêche pas de changer le statut tant qu'il ne bouge pas.
  IF NEW.balance IS DISTINCT FROM OLD.balance AND (NEW.balance > OLD.balance OR NEW.balance < 0) THEN
    RAISE EXCEPTION 'Facture émise : le solde ne fait que baisser, sans passer sous zéro.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_invoices_issued_locked';
  END IF;

  -- Avoirs (PR5) : règle de credited_amount_ttc ici.

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
