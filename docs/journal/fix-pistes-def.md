# Journal — fix-pistes-def (serveur)

Worktree `fm-fix-pistes-def`, branche `fix/defauts-pistes-def`, base `tests/piste-f`. Base Neon `tests-piste-c`.

## 2026-11-02T06:45:00+01:00 — Huit défauts des pistes D, E, F corrigés

- **Agent** : fix-pistes-def · **Branche** : `fix/defauts-pistes-def` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : (1) `POST /api/test-date-maintenance`, (2) `POST /api/document-renewals/quick-renew`, (3) `POST /api/workflows/:sessionId/documents` (garde `isWorkflowDocumentWriter`, le client n'alimente que sa propre session) reçoivent une garde de rôle. (4) `isoDateSchema` refuse les dates absentes du calendrier (30 février). (5) rapports `inventory` et `technician-performance` réservés au personnel concerné, date invalide en 400. (7) le démarrage d'une intervention par le technicien alerte le chef d'atelier. (8) un véhicule hors service n'est plus basculé en maintenance par un OT. (6) valorisation de l'export inventaire sur le stock vivant.
- **Comment** : gardes `isDocumentRenewalWriter`, `isInventoryReportReader`, `isTechnicianReportReader` (`server/middleware/auth.ts`) ; sur quick-renew la garde passe avant multer, aucun fichier n'est écrit pour un refusé. `parseReportPeriod` (`server/lib/report-period.ts`) lève `AppError(400)`. `isIsoCalendarDate` ajouté au schéma partagé et au service de pointage (400 avant le SQL). `notifyWorkOrderProgress` appelé hors chemin critique, erreur journalisée. `setVehicleToMaintenance` ne touche qu'un véhicule `operational`, comme le trigger `trg_work_orders_hold_vehicle`. Les `it.fails` / `test.fail` correspondants deviennent des tests normaux ; les trois routes sortent de la liste T1 du cliquet.
- **Pourquoi** : défauts figés par les pistes de test D, E, F. Valorisation (6) : `parts.real_stock` est une colonne Excel héritée, écrite par un seul chemin sur sept, donc périmée ; `parts.quantity` est le stock vivant. L'export valorise sur `quantity` et ses colonnes « Stock Théorique » et « Stock Réel » deviennent une seule colonne « Stock ». La colonne `real_stock` reste en base (chantier séparé).
- **Comment tester (QA)** : client ou chauffeur sur `/api/reports/inventory` : 403 ; `?startDate=2033-02-30` : 400 ; technicien qui passe un OT en cours : le chef d'atelier voit « Intervention démarrée — OT #N » dans ses alertes ; créer un OT sur un véhicule hors service : il reste hors service.
- **Preuve** : voir la description de la PR.
