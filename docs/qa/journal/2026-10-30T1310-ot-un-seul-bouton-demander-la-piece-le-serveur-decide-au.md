## 376dc15 - OT : un seul bouton « Demander la pièce », le serveur décide au clic

**Quoi**
- Stock suffisant : la pièce sort directement vers l'OT, au prix du catalogue.
- Stock insuffisant : le disponible sort vers l'OT, une demande `pending` est créée pour le manquant, l'OT
  passe en `awaiting_parts`. Une demande déjà en cours sur la même pièce est réutilisée, pas doublée.
- Le stock ne devient jamais négatif : le passage en force réservé au magasinier et à l'admin disparaît.
- `POST /api/work-orders/:id/parts` quitte `server/routes.ts` pour `work-order-parts.routes.ts` ;
  `POST .../awaiting-parts` avec une pièce passe par le même service (une pièce en stock ne part plus en
  demande).
- Écran OT : un seul bouton, aperçu du partage avant l'envoi, double clic neutralisé. Le sélecteur ne
  proposait que les 10 premières références (`/api/parts` pagine à 10) : il charge le catalogue.

**Comment**
- Calcul pur dans `server/lib/part-request.ts` (`splitPartRequest`, `describePartRequest`).
- Service `requestPartForWorkOrder` : une transaction, verrou sur l'OT puis sur la pièce, sortie par
  `addPartToWorkOrder(..., { requireAvailable: true })`.
- Temps réel en trois couches : invalidations locales (OT, listes, attente de pièces, demandes, stock,
  magasin) ; trames `part_used_added`, `part_requirement_created`, `work_order_updated`,
  `work_order_awaiting_parts` ; resync des écrans satellites par `useRealTimeSync`.
- Crescendo : unitaire (partage et messages), intégration (dont cinq demandes simultanées sur un stock de
  3), contrat HTTP (statuts, rôles, trames diffusées), e2e à deux rôles (technicien qui demande, magasinier
  qui reçoit la trame).

**Pourquoi**
- Le technicien demande une pièce ; c'est au serveur, pas à lui, de savoir si elle est en stock et de
  mettre l'OT en attente. Deux boutons (« ajouter », « attente de pièces ») laissaient le choix à l'écran.

**Preuve**
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 66/66 (12 fichiers) ; contrat 129/129
  (15 fichiers) ; e2e `10-work-order-part-request` 1/1.
- Contrat rejoué sur l'ancien code : 4 rouges sur 6 (stock épuisé, stock partiel, quantité invalide,
  pièce en stock envoyée en demande) ; restent verts le refus du magasinier et l'OT marqué sans pièce.
- Hors périmètre, à trancher : `PATCH /api/technician/work-orders/:id/status` ajoute encore des pièces sans
  garde de stock et avale les erreurs ; une demande réutilisée n'augmente pas sa quantité.

