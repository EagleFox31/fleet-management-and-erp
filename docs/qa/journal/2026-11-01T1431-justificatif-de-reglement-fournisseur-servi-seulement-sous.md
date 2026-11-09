## d6b2afe - Justificatif de règlement fournisseur : servi seulement sous uploads/ (sécurité)

**Quoi**
- `GET /api/supplier-invoices/:id/settlements/:settlementId/proof` ne sert plus un fichier hors de
  `uploads/` ; 400/404 au contrat d'erreur commun, plus de `details: error.message` en 500.

**Comment**
- `uploadedFileCandidates` (`server/lib/uploaded-file.ts`) remplace `startsWith(<cwd>/uploads)` ;
  `next(error)` vers le gestionnaire central (qui journalise le `console.error` retiré).

**Pourquoi**
- `proofReference` est libre via `POST /:id/payment` (legacy) ; le préfixe acceptait un dossier
  voisin (`uploads-old/secret.txt` servi en 200).

**Preuve**
- Contrat `supplier-settlement-proof-path` 3/3 (2 rouges sur l'ancien code) ;
  `supplier-settlement-idempotence` vert ; unitaire 822/822 ; `npm run check` 0 erreur.

