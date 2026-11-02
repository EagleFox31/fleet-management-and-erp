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

## 2026-11-02 : correctifs d'audit sécurité (PR 99)

- **Agent** : api-doc1 · **Branche** : `lot/api/doc1-centres`
- **Statut** : fait
- **Quoi** : (B1) `POST /quick-renew` acceptait un centre désactivé. (B2) la résolution par nom libre utilisait `ilike` sans échappement (`%`, `_`, `\` jokers, 500 sur `\` final), une variante d'espacement d'un centre désactivé créait un centre actif, et `centerName/Address/Contact/AccreditationNumber` n'avaient aucune borne. Mineur : `PATCH /centers/:id` ignorait un champ inconnu.
- **Comment** : un seul résolveur `server/lib/document-renewal-center-resolver.ts` (`resolveRenewalCenter`, `assertCenterNameFree`) appelé par `POST /requests`, `POST /quick-renew` et le routeur des centres : id puis nom par égalité sur `lower(btrim)` avec espaces répétés réduits, 404 inconnu, 409 désactivé (par id ou par nom), création implicite seulement si aucun centre de ce nom n'existe, course d'unicité (23505) relue. Champs `center*` bornés par `nameSchema` / `optionalText` du contrat (150/300/200/80). Le justificatif téléversé est supprimé quand le centre est refusé. `PATCH /centers/:id` renvoie 400 sur un champ hors `name, documentType, accreditationNumber, address, contact`.
- **Pourquoi** : audit sécurité de la PR 99.
- **Preuve automatisée** : `tests/contract/document-renewal-centers.contract.test.ts` (quick-renew 409 id et nom, variante d'espacement, jokers, 151 caractères, champ inconnu), `tests/unit/server/document-renewal-center-resolution.test.ts` (interdit `ilike(documentRenewalCenters.name` dans `server/api`).
- **RAIDER** : couvert D (contrats de statut et d'alertes rejoués), I (le résolveur rejoue sans doublon), R ; sans objet : migration.

## 2026-11-02 : correctifs de relecture et d'audit (PR 99, second passage)

- **Agent** : api-doc1 · **Branche** : `lot/api/doc1-centres`
- **Statut** : fait
- **Quoi** : (1) l'unicité applicative d'un centre portait sur le nom et le type alors que l'unicité SQL porte sur le nom seul : « Nom » (carte grise) puis « nom » (assurance) passait le contrôle et finissait en 23505. (2) Le 409 levé par le résolveur (course perdue) devenait un 500 dans les `catch` de `POST /requests` et `POST /quick-renew`. (3) La création implicite d'un centre n'émettait pas `document_renewal_center_changed`. (4) Les rôles de lecture étaient écrits en dur à deux endroits. (5) `PATCH /centers/:id/active` ignorait un champ inconnu. (6) Une assertion du test unitaire figeait l'ordre du catalogue d'événements.
- **Comment** : `assertCenterNameFree(name, excludeId?)` compare le nom normalisé tous types confondus ; message de doublon unique `DUPLICATE_CENTER_MESSAGE` (« Un centre de ce nom existe déjà. », sans mention de type), la copie du routeur est retirée. `cleanCenterName` (bords retirés, espaces dont l'insécable réduits) est appliqué avant insertion, à la création, au renommage et à la création implicite. Le `find` du résolveur est trié par `id`. Index unique fonctionnel `uq_document_renewal_centers_name_normalized` sur `regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')`, créé par `server/init-database.ts` et `server/db/migrations/20261102_document_renewal_centers_unique_name.sql` seulement si aucun doublon n'existe (vérifié : 0 doublon sur 6 centres de la base de test) ; sinon rien n'est créé et le contrôle applicatif plus le 23505 restent le filet. Les `catch` des deux routes passent une `AppError` à `next`, et leurs `console.error` (tous ceux du fichier, y compris la suppression du justificatif) sont migrés vers `moduleLogger("document-renewals")`. `broadcastCenterChanged` vit dans `server/lib/document-renewal-center-events.ts`, appelé par le routeur et par le résolveur à la création implicite (résultat marqué `created: true`). `DOCUMENT_RENEWAL_VIEWER_ROLES` (`shared/constants/roles.ts`) alimente `VIEW_ROLES` et la portée de l'événement. `PATCH /centers/:id/active` répond 400 sur un champ inconnu.
- **Pourquoi** : relecture et audit sécurité de la PR 99 (finding moyen sur l'unicité).
- **Preuve automatisée** : `tests/contract/document-renewal-centers.contract.test.ts` (« Nom » carte grise puis « nom » assurance en 409 sans mot « type », espace insécable, quatre POST concurrents de variantes de casse = un 201 et trois 409, événement à la création implicite, 409 du résolveur conservé sur `/requests` et `/quick-renew`, champ inconnu sur `/active`) ; `tests/unit/shared/document-renewal-centers.test.ts` (rôles de portée = `DOCUMENT_RENEWAL_VIEWER_ROLES`, plus d'assertion sur l'ordre du catalogue).
- **Hors périmètre, signalé** : `details: uploadError.message` et les `console.log` d'authentification (existants).
- **RAIDER** : couvert I (index créé seulement si absent et sans doublon, rejouable), D (contrats de statut, alertes et rôles rejoués), R (données existantes non modifiées) ; failure memory : course d'unicité couverte par un test concurrent.
