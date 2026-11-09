## 1dc6f93 - Documents de workflow : nom d'origine encodé dans Content-Disposition (sécurité)

**Quoi**
- `GET /api/workflows/documents/:id` sert le fichier avec un `Content-Disposition` sûr : nom ASCII
  inchangé, sinon repli ASCII + `filename*` UTF-8 qui restitue le nom exact.

**Comment**
- `server/lib/content-disposition.ts` (`contentDisposition(type, nom)`, RFC 6266 / 8187), même principe
  que le paquet `content-disposition` d'Express, sans dépendance ajoutée. Seul appelant à nom saisi :
  les autres en-têtes (exports, facture PDF, bon d'OT) portent un nom généré par le serveur.

**Pourquoi**
- `originalName` brut entre guillemets : caractère hors Latin-1 ou retour à la ligne → `setHeader`
  lève (500) ; un guillemet ouvrait un second paramètre `filename` (nom de téléchargement forgé).

**Preuve**
- Contrat `vehicle-documents-client-scope` 19/19 (2 rouges sur l'ancien code) ; unitaire
  `content-disposition` 8/8, total 820/820 ; `npm run check` 0 erreur.

**Reste**
- Sécurité : chemins stockés relus (`server/routes.ts` ~6090, rapports, preuves) ; `getRoleLabel`.

