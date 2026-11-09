## cf585de - Suppression d'un document de workflow : cloison entre clients

**Quoi**
- `DELETE /api/workflows/documents/:id` : un client ne supprime plus le document de la session d'un
  autre client (403). L'auteur de la session et le personnel suppriment.
- Document absent : 404 « Document non trouvé » au lieu d'une 500.

**Comment**
- Route passée de `authenticate` à `isAnyUser` + `canAccessOwned` sur l'auteur du workflow, comme la
  lecture `GET /api/workflows/documents/:id`.
- `WorkflowDocumentService.deleteWorkflowDocument` lève `AppError(404)` (suppression concurrente) ;
  `console.error` migré vers `moduleLogger`.
- Contrat : documents à usage unique avec leur propre fichier, pour ne pas casser les autres tests.

**Pourquoi**
- Trou de la cloison posée en 87c8678 : la lecture était fermée, la suppression restait ouverte à toute
  session (ids séquentiels).

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 ; contrats `vehicle-documents-client-scope` 16/16 et
  `fuel-records-and-document-paths` 15/15 ; aucun résidu dans `uploads/`.
- Sans correctif : 2 rouges sur 16 (le client A supprimait le document du client B ; l'absent donnait 500).

