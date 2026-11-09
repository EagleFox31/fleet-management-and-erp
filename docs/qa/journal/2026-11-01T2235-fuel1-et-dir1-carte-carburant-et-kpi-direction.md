## 2026-11-01 - FUEL1 et DIR1 : carte carburant et KPI Direction

**Quoi**
- `tests/contract/fuel-card-routes.contract.test.ts` : recharge (401, 403 par rôle, 201 par rôle autorisé, solde + montant, prix déduit, 400 sur six corps invalides), consommation (201, solde - coût, 400 par champ manquant), historique filtré (type, véhicule, année/mois, liste vide), statistiques mensuelles, par client, anomalies, liste des pleins par véhicule, suppression (403, 400, 404, 204, second appel 404).
- `tests/contract/management-dashboard-kpis.contract.test.ts` : le tableau de bord Direction est lu avant et après une transition réelle par l'API (OT en cours puis terminé, OT annulé, véhicule opérationnel, maintenance, hors service, plein saisi puis supprimé, facture fournisseur) ; seules les différences sont vérifiées.

**Pourquoi**
- Plan : FUEL1 et DIR1 étaient « partiel ». Le solde de la carte est global : valeurs absolues impossibles sur base partagée.

**Défauts figés (`it.fails`, assertion métier seule, requêtes jouées dans `beforeAll` puis lignes supprimées)**
- `POST /api/fuel-card/recharge` avec une date illisible : 500 (année NaN), `server/api/fuel-card.routes.ts:56`.
- `POST /api/fuel-card/consumption` : quantité `"abc"` acceptée en 201 et débit NaN écrit ; quantité négative acceptée en 201 (`fuel-card.routes.ts`, `fuel-card-service.ts:217`). Un débit NaN rend `balance` null pour toute la carte et désactive le contrôle `cost > balance` (comparaison avec NaN toujours fausse) : constaté en premier run, base nettoyée ensuite.
- Véhicule inconnu : 500 au lieu de 404 (`fuel-card-service.ts:218`) ; solde insuffisant : 500 au lieu de 409 (`fuel-card-service.ts:226`, la route renvoie 500 pour toute erreur) et message brut renvoyé.
- `GET /api/fuel-records/vehicle/:id` ouvert à un client pour un véhicule qui n'est pas le sien (`server/routes.ts:3290`, `authenticate` seul).

**Preuve**
- Contrat 48/48 (fuel-card-routes + management-dashboard-kpis, 6 `it.fails`).
- Rejeu du bloc de défauts sans `.fails` : 6 rouges (`expected 500 to be 400`, `expected 201 to be 400` x2, `expected 500 to be 404`, `expected 500 to be 409`, `expected 200 to be 403`).

**Limites**
- T5 : `tests/integration/stock-audit-columns.test.ts` écrit mais jamais exécuté, non livré (retiré de la PR). T8, T1, T3, T4 non commencés.
- Double soumission d'une recharge : aucune règle d'idempotence définie, non testée.
- Facture fournisseur : seule la saisie est couverte, pas validation/approbation/paiement.

**Reste**
- T5 (fichier écrit à exécuter), T8, puis T1, T3, T4.

