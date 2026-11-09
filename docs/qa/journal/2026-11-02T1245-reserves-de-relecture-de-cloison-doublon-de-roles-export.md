## Réserves de relecture de #86 : cloison, doublon de rôles, export stock

- **Quoi** :
  - Le téléversement `POST /api/workflows/:sessionId/documents` n'écrit plus sa requête d'appartenance : il passe par `canAccessOwned` (`server/lib/client-scope.ts`), avec `WorkflowDocumentService.getWorkflowOwnerId(workflowId, sessionId)`. Le message 403 est inchangé.
  - `DOCUMENT_RENEWAL_WRITER_ROLES` (`shared/constants/roles.ts`) devient la source unique de `isDocumentRenewalWriter` et de `CREATE_ROLES` dans `document-renewals.routes.ts`.
  - Colonne `realStock` de l'export stock : déjà absente de `excel-export-service.ts` (une seule colonne « Stock », lue sur `quantity`) et de `export-service.ts`. Rien à retirer ; le contrat DIR3 fige ce comportement en posant `realStock: 6` sans qu'il apparaisse. Les autres usages de `realStock` (alertes de stock, facturation TVA, écran entrepôt) ne passent pas par l'export.
- **Comment** : `npm run check` 0 erreur ; `npm test` 84 fichiers, 917 tests verts ; contrats `document-renewal-status`, `vehicle-acquisition-workflow`, `workflow-vehicle-acquisition`, `vehicle-documents-client-scope`, `lot-exports-roles`, `exports-inventory-content` : 232 verts sur la base `tests-piste-c`, sous `db-lock`.
- **Pourquoi** : une seule règle de cloison et une seule liste de rôles, pour qu'une correction ne soit pas faite à un seul endroit.
- **Complément après relecture** : `role-guards-pistes-def.contract.test.ts` (seul contrat du `POST /api/workflows/:sessionId/documents`) rejoué : 17 verts. Cas ajouté : un client qui envoie son propre `workflowId` avec le `sessionId` d'un autre est refusé (403, rien écrit), ce qui protège la clause `sessionId` de `getWorkflowOwnerId`. Liste en dur restantes, hors mission : `VIEW_ROLES` (`document-renewals.routes.ts`) et `isWorkflowDocumentWriter` (`auth.ts`).

