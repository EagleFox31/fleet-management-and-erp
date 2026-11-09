## b662936 - Routes secondaires : 400 lisible, double clic sur les boutons stock (T3, T4, T7)

**Quoi**
- PATCH document, planification de maintenance, utilisateur ; POST et PATCH plein carburant ; POST
  catalogue de pannes : corps invalide refusé en 400 par champ au lieu d'un 404, d'un 500 ou d'une
  valeur tronquée.
- La modification d'une planification depuis le formulaire est enfin enregistrée.
- `useSingleFlightMutate` sur les boutons restants qui écrivent de l'argent ou du stock.
- Valider ou refuser une demande de pièce vise la bonne demande.

**Comment**
- Niveau C d'abord (`tests/contract/secondary-routes-validation.contract.test.ts`, 15 cas). Il a révélé
  que toute édition de planification répondait 404 : `storage.getMaintenanceSchedule` était un bouchon.
- Planification : les deux `PATCH /api/maintenance-schedules/:id` fusionnés (la première, servie par
  Express, n'écrivait que `isActive`), `prepareColumnUpdate`, colonnes connues seulement.
- Documents : `prepareColumnUpdate` sur `name`, `description`, `expiryDate`, nom vide refusé.
- Utilisateur : `insertUserSchema.partial()` sur le corps sans mot de passe, 409 si nom ou e-mail
  déjà pris, mot de passe haché seulement s'il est saisi, logs migrés sans le corps.
- Carburant : schéma Zod commun (nombres de formulaire convertis puis validés), PATCH partiel avec
  repli sur l'enregistrement existant.
- Catalogue de pannes : `insertFaultCatalogSchema`, `createdBy` pris dans la session, `validatedBy` ignoré.
- Client : `useSingleFlightMutate` sur le règlement et le rapprochement fournisseur, la mise à jour
  d'une demande (réception), la sortie de stock depuis l'OT, le changement de statut d'une commande
  (la livraison entre du stock). Toasts par `userMessageOf`, emoji retiré du toast de demande.
- Demandes : l'id passe dans les variables de la mutation au lieu d'être lu dans `selectedRequest`.
- Garde-fous unitaires : `storage-stubs` (bouchons appelés, liste gelée de 2) et `routes-hygiene`
  (routes en double, liste gelée de 10 ; aucun `req.body` journalisé par `console.*`).

**Pourquoi**
- Un 404 sur une donnée qui existe fait croire à une suppression ; un `parseFloat("12abc")` enregistré
  à 12 fausse la consommation sans que personne ne le voie.
- Les champs tenus par le serveur (`createdAt`, `validatedBy`, `createdBy`) ne viennent pas du client (T4).
- Incidents : LESSONS_LEARNED « Planification : modifications perdues, puis 404 sur toute édition »,
  « Mot de passe en clair dans les journaux », « Erreurs de validation rendues en 404 ou en valeur
  tronquée », « Valider ou refuser une demande visait la demande précédente ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 395/395 ; `npm run test:integration` 45/45 ;
  `npm run test:contract` 76/76 ; 0 ligne `TEST-` orpheline.
- Contrat rejoué sans les correctifs serveur : 13 rouges, 2 verts (non-régressions déjà vraies). Le cas
  « POST quantité illisible » est exclu de ce rejeu : sans correctif il crée un plein que le nettoyage
  ne sait pas retirer.
- T4 PATCH demande de pièce (`requestedBy` ignoré) rouge sans son correctif (introduit en 179015d), vérification restée ouverte jusqu'ici.
- `routes-hygiene` rouge sur la version précédente de `server/routes.ts`, `storage-stubs` rouge sans
  l'implémentation de `getMaintenanceSchedule`.
- Pas d'e2e pour la fermeture périmée des demandes : voir la prévention dans LESSONS_LEARNED.

