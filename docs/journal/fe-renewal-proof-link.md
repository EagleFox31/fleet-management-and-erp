# Lien de telechargement du justificatif de renouvellement (feat/renewal-proof-link-ui)

## Quoi
- `client/src/pages/vehicles/documents.tsx` : bouton `Download` (lucide) par demande, vers `GET /api/document-renewals/requests/:id/proof` (#401).
- Visible si le role est dans `DOCUMENT_RENEWAL_VIEWER_ROLES` et si la demande porte `proofFileName` (deja renvoye par la liste).
- Fichier recupere en blob puis enregistre sous son nom d'origine ; erreur affichee par `userMessageOf` dans un toast, jamais de message technique.
- `tests/unit/client/renewal-proof-link.test.ts` : route, garde de role, message d'erreur.

## Comment
- Pas de nouvelle route ni de nouveau schema ; le serveur reste maitre des roles et du perimetre (403/404 traduits en clair).
- Garde anti double clic par `useRef` (AGENTS.md §10) : `disabled={proofBusyId !== null}` ne change qu'au rendu suivant.

## Pourquoi
Le justificatif deposé au renouvellement rapide n'etait pas consultable depuis la liste des demandes ; les roles lecteurs devaient passer par le serveur de fichiers.

## Preuves
`npm run check` : zero erreur TS. Tests unitaires : 2581 verts. Non verifie a l'oeil ni en e2e.
