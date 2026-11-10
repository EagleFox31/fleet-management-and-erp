## 2026-11-10 11:05 - POD client : dépôt, liste, facture fermée sans preuve, PDF en pièce jointe

**Quoi.** Fiche mission : vrai dépôt de POD (remplace le faux bouton), liste avec vignette, ouverture (images) et téléchargement, bouton de facture désactivé avec la raison écrite à l'écran. Espace chauffeur : tuile « Déposer le POD » (appareil photo arrière). Temps réel : `mission_pod_uploaded` rafraîchit la liste des POD ouverte chez un autre profil. Serveur : les PDF sortent en pièce jointe.

**Comment.**
- `client/src/lib/mission-pod.ts` : règles pures (`canDepositPod`, `invoiceGate`), dépôt, et `applyPodUploaded` (cache local, puis invalidation du détail, de la liste, des factures à émettre, de `/api/drivers/me` et des satellites).
- `client/src/hooks/use-mission-pod.ts` : lecture (gabarit littéral exigé par le garde `byId` de `realtime-satellites`) et dépôt (`useSingleFlightMutate`, `userMessageOf`).
- `client/src/components/missions/mission-pod-panel.tsx` : liste, bouton de dépôt masqué hors rôle ou statut, erreur de lecture en `InlineQueryError`, jamais de faux « aucun POD ».
- `client/src/pages/missions/[id].tsx` et `driver/dashboard.tsx` : branchements ; le bouton « Modifier » de la mission reçoit `button-edit-mission` (la carte de prix en porte un second, ambiguïté dans les e2e).
- `server/api/mission-pod.routes.ts` : `Content-Disposition: attachment` pour les PDF (le visionneur PDF de Chrome refuse un document sous `CSP: sandbox`), images en ligne ; `sandbox` posé dans les deux cas.

**Pourquoi.** Le serveur refuse la facture sans POD (409) : sans écran de dépôt, la logistique ne pouvait plus facturer. Une lecture en échec ne doit jamais se lire « aucun POD » ni ouvrir la facture.

**Preuve.** Tests de rendu `mission-pod-render` (7) et `realtime-satellites`, chaque garde vue rouge puis verte ; contrat POD 22/22 ; Playwright sur base locale isolée : 29 (deux comptes, trame WebSocket réelle) vert, 13 et 17 verts (9/9 avec les tests voisins).
