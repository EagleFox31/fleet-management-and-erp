# Journal api-doc1 : centres de renouvellement (DOC1)

## 2026-11-02 : gestion des centres, partie serveur

- **Agent** : api-doc1 · **Branche** : `lot/api/doc1-centres` · **Commit** : voir PR
- **Statut** : fait (serveur ; écran à faire par fleet-fe)
- **Quoi** : `POST /api/document-renewals/centers`, `PATCH /centers/:id`, `PATCH /centers/:id/active` (désactiver / réactiver, pas de DELETE). `GET /centers?includeInactive=1` renvoie aussi les désactivés, 403 hors rôles écrivains. Une demande vers un centre désactivé (par id ou par nom) est refusée en 409.
- **Comment** : routeur `server/api/document-renewal-centers.routes.ts` monté après `document-renewals.routes.ts` sur le même préfixe (le GET reste dans l'ancien, aucune route paramétrée en commun). Écriture par `isDocumentRenewalWriter` (`DOCUMENT_RENEWAL_WRITER_ROLES`). Contrat `shared/contracts/document-renewal-centers.ts` (Zod strict). Nom unique insensible à la casse par type de document (409) ; l'unicité SQL existante sur `name` seul est traduite en 409. Événement `document_renewal_center_changed` (rôles, fin de catalogue) et son `case` en fin de switch client. `console.error` du GET migré vers `moduleLogger`.
- **Pourquoi** : DOC1, un centre mal saisi ne pouvait être ni corrigé ni retiré des choix.
- **Comment tester (QA)** :
  - Prérequis : comptes secrétaire et technicien.
  - Étapes : 1. secrétaire crée un centre, le désactive. 2. technicien liste les centres. 3. secrétaire tente une demande vers ce centre.
  - Attendu : le centre n'est plus dans les choix, la demande est refusée (409), les demandes déjà créées gardent le nom du centre.
  - Preuve automatisée : `tests/contract/document-renewal-centers.contract.test.ts`, `tests/unit/shared/document-renewal-centers.test.ts`.
- **RAIDER** : couvert D (GET et demandes existants inchangés, contrats de statut et d'alertes rejoués), I (désactiver deux fois = même état), R (aucune colonne, aucune migration) ; sans objet : migration.
- **Reste / risques** : l'unicité SQL porte sur `name` seul alors que la règle métier est « par type » : deux types ne peuvent pas partager un nom (tâche fleet-db si besoin). Écran « Centres » côté client.
