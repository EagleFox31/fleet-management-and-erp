## 2026-11-09T16:04:00+01:00 — Ordres de travail : export PDF et alertes d'échéance lus en entier (cliquet 7 → 5)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `maintenance/work-orders.tsx` : la requête `/api/work-orders` des 300 derniers OT (relue toutes les 7 s) ne servait qu'à l'export PDF. Elle est supprimée : l'export lit toutes les pages au clic (`fetchAllWorkOrders`). « Export réussi » n'est annoncé qu'après une lecture complète ; une liste vide ne produit pas de PDF (« Aucun ordre de travail à exporter ») ; un refus s'affiche par `userMessageOf` et se journalise par `clientLogger.error(…, reportErrorContext(error))`. Double clic bloqué par une ref ;
  - `maintenance/date-based-alerts.tsx` : « cette alerte a déjà son OT » se déduisait des 300 derniers OT. Un OT plus ancien était ignoré, l'alerte redevenait « à faire » et la génération en masse pouvait créer un doublon. Lecture complète (`["/api/work-orders", "all"]`, même préfixe pour les invalidations). Tant qu'elle n'a pas réussi, les boutons de création sont désactivés et un `InlineQueryError` propose « Réessayer » ;
  - `capped-list-reads-hygiene` : 2 fichiers retirés de la liste gelée (7 → 5 cas).
- **Comment tester (QA)** :
  - `tests/unit/client/work-orders-full-reads.test.ts` : 4 cas de branchement sur l'export (rouges avant) ; rendu `react-dom/server` des alertes avec la lecture des OT en erreur : boutons « Créer OT atelier » et « Générer les OT atelier » désactivés, encart d'erreur présent (rouge sur l'ancien code : bouton actif) ; témoin sain ; OT existant reconnu ;
  - campagnes : unitaires 327 fichiers / 3395 tests ; tsc 0 ; check:tests 0. Aucun code serveur touché.
- **RAIDER** : D : contrat d'API inchangé ; les deux écrans ne concluent plus sur une liste partielle.
- **Reste / risques** : 5 lectures plafonnées gelées (inventaire, interventions — 1000 demandés, 500 rendus —, pièces de l'OT, dialogue de montage ×2). La liste de véhicules des alertes (`["/api/vehicles"]`, sans `limit`) ne rend que 10 véhicules (`VEHICLE_LIST_DEFAULT_LIMIT = 10`) : alertes calculées sur 10 véhicules seulement, hors du cliquet (pas de `limit` en dur) ; signalé, lot à part.

