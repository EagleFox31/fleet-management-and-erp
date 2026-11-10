## 2026-11-10 10:10 - POD : correctifs de la CI rouge de #629 (hygiène, ménage de comptes, forme figée)

**Quoi.** Intégration : `mission_pod_files` (FK vers `users.id` et `missions.id`) est supprimée dans le ménage de comptes de test. Unit : cinq gardes d'hygiène échouaient sur le routeur POD. Réserves de relecture : forme du POST figée, cas doublon, événement temps réel branché.

**Comment.**
- `tests/support/cleanup.ts` : suppression des fichiers POD par mission et par auteur avant les missions et les comptes (la liste gelée `NOT_YET_HANDLED` ne bouge pas).
- `server/api/mission-pod.routes.ts` : cycle de vie multer (drapeau `recorded`, nettoyage en `finally`), segment validé par `isSafePathSegment`, suppression, lecture de l'en-tête, empreinte et envoi passent par `uploadedFileCandidates` (borne qui résout les liens).
- `shared/contracts/mission-pod.ts` : `{files, duplicates, fileCount}` figé ; le contrat rejoue le même fichier (aucun second enregistrement) et vérifie client 403 et chauffeur non affecté 403 sur les deux GET.
- `useRealTimeSync.ts` et `realtime-satellites.ts` : `mission_pod_uploaded` invalide détail de mission, liste des missions et `/api/billing/pending-invoices`.

**Pourquoi.** Tests fautifs en unit : `multer-lifecycle-hygiene`, `multer-storage-hygiene`, `stored-path-hygiene`, `upload-delete-hygiene`, `realtime-satellites` (gabarit par identifiant sans écran, retiré jusqu'à la PR 2).

**Preuve.** tsc 0 erreur ; unit 3593 verts (restent db-pool-options et backup-db, propres à ce poste) ; contrat POD 19/19 ; intégration FK 3/3.
