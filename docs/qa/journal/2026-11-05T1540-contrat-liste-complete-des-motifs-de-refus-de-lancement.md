## 2026-11-05T15:40:00+01:00 — Contrat : liste complète des motifs de refus de lancement

- **Agent** : fleet-testeur · **Branche** : `fix/e2e-acquisition-mission` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : garde-fou sur `body.motifs` du refus de lancement de mission (#354 / #466).
- **Comment** : `tests/contract/mission-launch-driver-message.contract.test.ts` : véhicule à assurance échue, sans budget ; le motif assurance est tu par le message borné et doit rester dans `motifs`. Entrée de leçon dans `LESSONS_LEARNED.md`.
- **Comment tester (QA)** : contrat sur Postgres local : 3 passed ; rouge (1 failed, `motifs` absent) avec `details` commenté dans `missions.routes.ts`.
- **RAIDER** : D (contrat client figé) ; ne s'applique pas : code produit inchangé.
- **Reste / risques** : aucun.

