## 2026-11-05T00:45:31+01:00 — Démo logistique (lot 2, profil 1)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-2` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : parcours logistique filmé : création de la mission (assistant en 4 étapes), lancement avec budgets, livraison, clôture, facture client.
- **Comment** : `e2e/demo/04-logistique.spec.ts` ; seed enrichi (client donneur d'ordre, véhicule aux 3 papiers valides, chauffeur avec date CPC récente, crédit de carte). Le statut CPC affiché est recalculé depuis la date de formation : le seed fournit la date, pas seulement le libellé.
- **Pourquoi** : démonstration par profil.
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale fleet_test ; attendu 1 passed, 2 passages.
- **RAIDER** : I (missions de démo purgées à chaque seed), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : une mission créée avec véhicule et chauffeur reste « planned » (non « assigned ») : à confirmer côté produit.

