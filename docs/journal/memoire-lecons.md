# Journal — mémoire des incidents (leçons)

Consigne les mises à jour de `docs/analysis/LESSONS_LEARNED.md` faites hors lot de développement.
Format : `docs/journal/README.md`.

## 2026-11-06T02:00:00+01:00 — Leçons des PR #525 à #540

- **Agent** : mémoire d'échecs · **Branche** : `docs/lecons-2026-11-06`
- **Statut** : fait
- **Quoi** : enrichissement de `docs/analysis/LESSONS_LEARNED.md` : une récidive (règle de coût sur une route, routes sœurs ouvertes), une garde de statut contournée, trois nouvelles entrées (masque sur `returning()`, montants en texte libre, test instable sans corps de réponse) et une section de dettes ouvertes.
- **Comment** :
  - Récidive et règle de calcul ajoutées à l'entrée « Prix d'achat du véhicule » (2026-11-04).
  - Récidive ajoutée à l'entrée « Effet argent sur une transition » (2026-11-05, L1d).
  - Nouvelles entrées en fin de fichier ; la section de dettes couvre `syncInvoiceFromReconciledSettlements`, le `console.log` des rotations de pneus, `estimatedFuelCost` et les tests intermittents.
  - Chaque prévention citée a été vérifiée dans `origin/main` (existence du fichier). Les préventions absentes sont écrites « prévention manquante » avec l'agent à qui les confier.
  - `feature-flags.contract` n'a aucun `skip`, `todo` ni `fails` : omis.
- **Pourquoi** : les PR #525 à #540 contiennent des erreurs déjà documentées (prix d'achat, prix convenu, compare-and-set). Une récidive se consigne sur l'entrée existante avec un contrôle plus fort, pas dans une nouvelle entrée.
- **Comment tester (QA)** :
  - Prérequis : dépôt à jour sur `docs/lecons-2026-11-06`.
  - Étapes : 1. `grep -n "Récidive (2026-11-06)" docs/analysis/LESSONS_LEARNED.md` ; 2. `grep -n "^## 2026-11-06" docs/analysis/LESSONS_LEARNED.md` ; 3. vérifier qu'un fichier cité existe : `ls tests/unit/server/status-update-cas-hygiene.test.ts tests/unit/server/mission-select-hygiene.test.ts tests/contract/stock-valuation-readers.contract.test.ts`.
  - Attendu : 2 récidives et 4 nouvelles entrées trouvées ; les trois fichiers listés existent.
- **RAIDER** : Failure memory couverte (leçons, classification, prévention vérifiée ou marquée manquante). Ne s'applique pas : code, tests, CI (docs seulement).
- **Reste / risques** : préventions manquantes à produire par fleet-testeur (prix unitaire des pièces, texte libre de l'audit d'OT, assertions de statut, console des montants, cas `disputed`). Le correctif Q22 et Q23 n'est pas fusionné. `AGENTS.md` §9 n'est pas modifié : les dettes sont dans `LESSONS_LEARNED.md`, à reporter dans §9 par un agent autorisé à écrire ce fichier.
