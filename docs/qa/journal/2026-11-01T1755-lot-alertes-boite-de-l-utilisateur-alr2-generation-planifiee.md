## Lot d9d09b1, a32b671 - alertes : boîte de l'utilisateur (ALR2), génération planifiée (ALR1, ALR3)

**Quoi**
- `d9d09b1` : `server/api/alerts.routes.ts` (lu, tout lu, suppression) filtré sur l'utilisateur de
  session ; `POST /api/alerts/read-all` ; événement `alerts_read` (scope user) ; bouton « Tout marquer
  lu » ; doublons morts retirés de `server/routes.ts` et de la liste gelée.
- `a32b671` : clé de rappel quotidien sur les générateurs planifiés, insertion `ON CONFLICT DO NOTHING`
  sur `uq_alerts_user_dedupe`, pas d'événement sans création.

**Pourquoi**
- ALR2 : n'importe quel compte pouvait marquer lue ou supprimer l'alerte d'un autre ; pas de « tout lu ».
- ALR1 : une alerte lue revenait toutes les 5 min ; deux passages simultanés la doublaient.

**Preuve**
- Rouge sur l'ancien code : `alerts-inbox` 5/6 (200 au lieu de 404 hors périmètre, route read-all
  absente, événement non déclaré), `alert-generation-dedupe` 2/5 (concurrence, alerte lue recréée).
- Vert : contrat 12/12 (avec `notification-settings`, `incidents`), intégration
  `alert-generation-dedupe` 6/6 (dont alerte antérieure à la clé non doublée), unitaire 846/846,
  `tsc` 0 erreur.

**Limites**
- Rappel quotidien : une alerte lue revient le lendemain si l'objet est toujours en défaut.
- ALR3 couvert en intégration (événement par destinataire, technicien exclu), pas en e2e.
- `document-expiry-alerts` dépasse 90 s, sur main comme sur la branche : le passage parcourt tous les
  documents réels de la base partagée. Préexistant, non traité ici.

**Reste**
- DOC1/DOC3 ; FUEL3 à cadrer ; FUEL2, VEH2, MNT1/2, DIR2/3.

