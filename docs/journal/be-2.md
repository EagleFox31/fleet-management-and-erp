# Journal — Backend 2 (`be-2`)

Worktree : `../fm-be-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T17:12:46+01:00 — T-17a — Alertes d'échéance des documents véhicule typés
- **Agent** : be-2 · **Branche** : `lot/api/T-17b-should-notify` (PR #41, fusionne T-16) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : alerte pour tout document véhicule dont l'échéance tombe dans les `alert_days` de son type (30 par défaut, J+0 à J+30 inclus) ou est déjà échue.
- **Comment** : règle pure `server/services/document-expiry-rule.ts` (jours calendaires UTC, horloge injectée, clé `doc_expiry:<statut>:<id>:<échéance>`). `AlertService.checkTypedDocumentExpiryAlerts` joint `vehicle_documents` aux types (actifs, `validity_months` renseigné), émet via `createAlertIfNotExists` avec `topic: documents` (donc filtré par `shouldNotify`) vers les rôles maintenance ; appelé par `runAllAlertChecks` donc par le scheduler existant. `createAlertIfNotExists` gagne `dedupeKey` optionnel (alerte lue ou non, jamais recréée ; nouvelle échéance = nouvelle clé) et un échec sur un destinataire ne prive plus les autres. Événement `alert_created` (scope utilisateur) déjà émis par cette fonction. Build : Adapt.
- **Pourquoi** : P-05 / R-12, éviter les documents échus sans préavis ; une seule modification de `alert-service.ts` pour le lot (PR-08).
- **Comment tester (QA)** :
  - Prérequis : un chef d'atelier, un véhicule, un document `visite_technique` avec échéance à J+30.
  - Étapes : 1. lancer le cycle d'alertes (scheduler). 2. le relancer. 3. marquer l'alerte lue et relancer.
  - Attendu : une seule alerte thème `documents` ; rien à J+31 ni pour un type sans échéance (`taxe`) ; aucun doublon ; un utilisateur ayant coupé `documents` ne la reçoit pas.
  - Preuve automatisée : `tests/unit/server/document-expiry-rule.test.ts` (J+29, J+30, J+31, échu) ; `node ../lot-tools/db-lock.mjs be-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/document-expiry-alerts.test.ts` → 2 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert idempotence (clé par document et échéance), non-régression (chemin sans `dedupeKey` inchangé), retroactif (documents existants pris au prochain cycle) ; sans objet : migration (colonnes existantes). Note : l'intégration est sensible aux nettoyages globaux d'autres suites sur la base partagée ; les comptes du test sont donc hors préfixe TEST_.
