## 4d878ea - Chemins disque des documents, saisie et modification d'un plein (T1, T3)

**Quoi**
- Téléversement d'un document de workflow : `sessionId` et `documentType` viennent de la requête et
  devenaient des segments de chemin. `..%2F..%2Fx` (décodé par Express) écrivait hors de
  `uploads/workflows`. Désormais 400 lisible, rien n'est écrit.
- Les deux téléchargements (`/api/documents/:id/download`, `/api/workflows/documents/:documentId`)
  ne servent qu'un fichier situé sous `uploads/` (404 sinon).
- `transferDocumentsToVehicle` : l'INSERT `vehicle_documents` était une chaîne interpolée (apostrophe
  = requête cassée ou SQL injecté) ; le nom d'origine servait de nom disque sans retirer les
  répertoires. Code sans appelant aujourd'hui, corrigé avant qu'il n'en ait.
- `POST /api/fuel-records` réservé aux profils qui ont un écran carburant (admin, chef d'atelier,
  technicien, secrétaire, logistique) ; `PATCH` à l'auteur du plein ou à l'admin, comme
  `canEditFuelRecord` côté client.

**Comment**
- Unitaire : `isSafePathSegment` (`server/lib/uploaded-file.ts`, 10 cas) ; matrice RBAC
  `isFuelRecordWriter` dans `auth-middleware.test.ts`.
- Intégration (`tests/integration/workflow-document-transfer.test.ts`, 5 cas) : nom avec apostrophe
  et SQL enregistré tel quel, nom avec `../` copié dans le dossier du véhicule, `factur_achat` rangé
  en `autre`, `AppError` 400 sur session ou type invalide.
- Contrat (`tests/contract/fuel-records-and-document-paths.contract.test.ts`, 14 cas) : 403 client et
  magasinier, 403 non-auteur, 400 `VALIDATION` sur les deux segments, 404 sur chemin stocké hors de
  `uploads/`, et les non-régressions (technicien, auteur, admin, téléversement normal, deux formes
  stockées servies).
- `secondary-routes-validation` : les pleins modifiés par le chef d'atelier lui sont attribués
  (changement de contrat voulu : un non-auteur reçoit maintenant 403).
- Ménage des deux nouveaux tests : disque d'abord, noms uniques. Le premier rejeu sans correctif
  avait laissé des fichiers à la racine du projet et dans `uploads/` : le ménage base échouait (pleins
  non suivis créés par client et magasinier) avant d'atteindre le disque.
- `console.*` de `workflow-document-service.ts` migrés vers `moduleLogger("workflow-documents")`.

**Pourquoi**
- Un paramètre d'URL est décodé avant d'arriver à la route : `%2F` devient `/`. Tout segment de chemin
  venu de la requête doit être validé, pas seulement concaténé.
- Règle carburant tirée des écrans (menu, `/technician/fuel`, `canEditFuelRecord`) :
  `PROFILS_ACCES.md` ne cite qu'admin et logistique pour « Consommations », mais vise la carte
  carburant. Écart à trancher dans la matrice.
- Incident : LESSONS_LEARNED « Paramètre de requête utilisé comme segment de chemin disque ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 431/431 ; `npm run test:integration` 58/58 ;
  `npm run test:contract` 99/99 ; 0 ligne `TEST-` orpheline, aucun fichier de test sous `uploads/`.
- Rejoué sans le correctif serveur : contrat 9 rouges, 5 verts (non-régressions) ; intégration 5/5
  rouges ; aucun fichier laissé hors des dossiers de test.
- Deux passages complets précédents avaient des rouges dans des fichiers non touchés (erreurs Neon
  dans `createTestUser`, 84 tests sautés au premier) ; rejoués seuls puis en suite complète : verts.
  Cause non établie.

