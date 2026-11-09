## 009684f - Anciens bouchons de stockage : suppression de document, OT par technicien et par client (T1, T7)

**Quoi**
- `DELETE /api/documents/:id` supprime enfin la ligne et le fichier. Avant, la route répondait 204 et
  l'écran « Document supprimé » alors que rien n'était supprimé.
- `GET /api/work-orders/technician/:id` renvoie les OT du technicien au lieu d'une liste toujours
  vide ; un technicien ne lit que les siens (403 sinon).
- `GET /api/work-orders` pour un client : les OT de ses véhicules au lieu d'une liste vide.
- Liste d'OT du technicien : le filtre de statut vaut aussi pour ses propres OT.
- Écran documents : corbeille réservée à l'admin et au chef d'atelier, garde double clic, toast lisible.

**Comment**
- Unitaire d'abord : `uploadedFileCandidates` (`server/lib/uploaded-file.ts`, 12 cas) ne renvoie que des
  chemins sous `uploads/`, pour les deux formes stockées (`uploads/...` de multer, `/uploads/...` ancien).
- Garde `storage-stubs` élargie aux bouchons qui renvoient un objet vide : elle a trouvé
  `getWorkOrdersByOwner` (`{ workOrders: [], total: 0 }`), appelé pour tout client et invisible jusqu'ici.
  Liste gelée désormais vide.
- Intégration (`tests/integration/storage-former-stubs.test.ts`, 8 cas, 8 rouges sans le correctif) :
  la ligne d'abord, le fichier ensuite ; un fichier encore référencé par un autre document est
  conservé ; un chemin hors de `uploads/` n'est jamais supprimé ; un fichier absent ne bloque pas.
- `getWorkOrdersForTechnician` : `OR` de Drizzle non parenthésé dans `and(...)`, d'où
  `A AND B OR C`. Parenthèses explicites.
- Contrat (`tests/contract/former-storage-stubs.contract.test.ts`, 9 cas) : 204 puis 404 au contrat,
  403 technicien et magasinier, 401 sans session, client limité à ses véhicules.
- Route DELETE : 404 si la ligne a disparu entre-temps, événement `vehicle_updated` avec `documentId`
  (le client invalide déjà listes, KPI et alertes documents sur ce cas), `console.error` migré.
- UI (`e2e/09-vehicle-document-delete.spec.ts`, 2 cas) : suppression par double clic sur la
  confirmation, une seule requête, document absent de l'écran, de la base et du disque ; secrétaire
  sans corbeille. Les boutons sont cherchés par préfixe « Supprimer » pour que le test vaille aussi
  contre l'ancien écran.

**Pourquoi**
- Un succès affiché sans effet est pire qu'une erreur : l'utilisateur croit le document retiré.
- Le fichier est supprimé après la ligne : si le disque échoue, il reste un fichier orphelin, pas un
  document qui pointe vers un fichier disparu.
- Incidents : LESSONS_LEARNED « Garde des bouchons aveugle aux objets vides » et
  « OR Drizzle non parenthésé dans and() ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 407/407 ; `npm run test:integration` 53/53 ;
  `npm run test:contract` 85/85 ; 0 ligne `TEST-` orpheline, aucun dossier de test sous `uploads/`.
- Contrat rejoué sans les correctifs serveur : 6 rouges, 3 verts (non-régressions déjà vraies).
- e2e 09 vert (2/2), serveur local sur 5055 ; rejoué avec l'ancien composant : 2 rouges (deux DELETE
  envoyés, corbeille visible pour la secrétaire).

