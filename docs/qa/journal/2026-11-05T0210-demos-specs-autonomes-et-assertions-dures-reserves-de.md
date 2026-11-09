## 2026-11-05T02:10:00+01:00 — Démos : specs autonomes et assertions dures (réserves de relecture de #331)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : chaque spec de démo (01 à 07) rejoue `seedDemo()` en `beforeAll` et devient autonome ; la spec magasinier exige la carte de l'OT en attente de pièces (plus de repli par URL) ; la spec direction cible le bouton « Rapports Direction » par son rôle.
- **Comment** : `e2e/demo/01..07-*.spec.ts` ; le seed est idempotent, donc le rejeu est sans effet de bord.
- **Comment tester (QA)** : `E2E_DEMO=1` sur `e2e/demo`, 2 passages de 7 specs verts avec rejeu du seed entre les deux (3,7 min chacun) ; `npm run check` à 0 erreur ; unitaires 202 fichiers / 2335 tests verts.
- **RAIDER** : I (specs rejouables seules) ; D (assertions dures) ; ne s'applique pas : code produit.
- **Reste / risques** : facture de période pour les rapports de direction et paiement de facture dans la PR suivante.

