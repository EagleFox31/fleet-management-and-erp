## Lot 09f4a7c, a03d7a6, e246e1c, fe07afc - rôles, pneus, planification, documents de workflow

**Quoi**
- `09f4a7c` : libellés de rôle par `roleLabelOf` (`client/src/lib/contextual-help/roles.ts`) ; cinq
  tables locales retirées (liste utilisateurs, page techniciens, profil, barre du haut, admin).
- `a03d7a6` : `PATCH /api/vehicle-tires/:id/remove` refuse un kilométrage de démontage inférieur à
  celui du montage (400 lisible, pneu toujours monté, stock inchangé).
- `e246e1c` : `POST /api/maintenance-schedules` : véhicule inconnu 404, date illisible 400 nommé ;
  `POST /:id/generate-work-order` : id illisible 400. Les trois finissaient en 500.
- `fe07afc` : documents rattachés à l'activation d'un véhicule depuis le workflow : chemin borné à
  `uploads/` (`uploadedFileCandidates`) ; `createdAt` en chaîne retiré (l'insertion échouait toujours).

**Pourquoi**
- Un magasinier, un logisticien ou la direction s'affichait « Utilisateur » dans la liste.
- Un démontage à rebours fausse l'usure et le coût au km du pneu.
- `file_path` vient du corps : un fichier du serveur hors `uploads/` devenait un document du véhicule.

**Preuve**
- Rouge sur l'ancien code : 1 unitaire (garde-fou), 2 intégration, 4 contrat.
- Vert : `role-labels` 3/3, `workflow-document-paths` 2/2, `tires-rbac` + `secondary-routes-validation`
  38/38, unitaire 825/825, `npm run check` 0 erreur.

**Reste**
- Pneus : stock usagé mélangé au neuf. WO3, WO5, parcours P2/P3/P6, soft delete, DOC/FUEL/ALR/DIR.

