## Piste C, étape 2 : cloison client sur les lectures de véhicule, deux clients et le personnel

**Quoi**
- `tests/contract/vehicles-two-clients-isolation.contract.test.ts` (7 cas) : `GET /api/vehicles` (chacun ne voit que le sien, total 1, recherche de l'immatriculation d'autrui = 0, personnel voit tout), `GET /api/vehicles/all`, `GET /api/vehicles/:id` par id et par immatriculation (sien 200, autre client 403 sans fuite de l'immatriculation, personnel 200, sans session 401), véhicule sans propriétaire refusé aux clients, inconnu 404 (jamais 500).

**Comment**
- Trois comptes réels (admin, client A, client B), trois véhicules, `createApp` en mémoire ; nettoyage des lignes créées.

**Pourquoi**
- Le plan T8 notait que `GET /api/vehicles` ne filtrait pas sur le propriétaire ; #80 l'a corrigé. Il manquait un test à deux clients qui garde la cloison.

**Preuve**
- Vert 7/7 sur la branche de test. Rouge sur la version fautive : en neutralisant le refus du détail (`server/routes.ts:1076`, condition remplacée par `false`), 3 des 7 cas échouent (par id, sans propriétaire, par immatriculation). Aucun défaut produit constaté, donc aucun `it.fails`.


