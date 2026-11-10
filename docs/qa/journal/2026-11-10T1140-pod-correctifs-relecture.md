## 2026-11-10 11:40 - POD : correctifs de relecture avant fusion de #634

**Quoi.** Couvre aussi les commits 1a979975 (mission vérifiée avant multer, empreinte en flux, limites de champs, erreurs d'upload en 400, GET sans cache), 0fcb355c (migration POD : `lock_timeout` de 5 s après le verrou consultatif), 55fa7baa (liste des pièces rafraîchie par `mission_pod_uploaded`) et 73da7a5c (E2E POD chauffeur vers logistique avec trame WebSocket).

**Comment.**
- `server/api/mission-pod.routes.ts` : `ensureMissionExists` lit aussi le statut et refuse en 409 (brouillon, annulée, planifiée...) avant multer, donc sans dossier ni fichier ; le verrou `FOR UPDATE` de la transaction reste l'arbitre.
- Plafond de 50 fichiers par mission (`POD_MAX_FILES_PER_MISSION`), contrôlé dans la transaction après insertion sous verrou : le dépassement annule toute la remise (409 lisible).
- Erreurs multer : `MulterError` et multipart tronqué ou mal formé (messages busboy reconnus) donnent 400 ; toute autre erreur (disque plein, droits, dossier occupé) devient `AppError(500)` journalisée, plus jamais « dépôt invalide ».
- Fichier laissé à moitié écrit par un flux tronqué : multer ne connaît que les fichiers terminés. Les chemins sont notés à l'ouverture (`filename`) et supprimés à toute erreur de multer.
- Client : `e.target.value = ""` dans le `onChange` du dépôt (copie de la liste faite avant) pour reprendre le même fichier après un échec. Le hook `use-mission-pod.ts` ne lit pas l'input, rien à y changer.

**Pourquoi.** Un 409 après multer laissait un dossier ; une panne disque était présentée comme une faute du client ; un flux coupé laissait un fichier orphelin ; sans plafond, une mission pouvait accumuler des fichiers sans limite ; sans remise à zéro de l'input, le même fichier ne pouvait pas être choisi deux fois.

**Preuve.** Contrat POD 28/28 : multipart tronqué (rouge d'abord : un fichier résiduel, puis vert), 6e champ, 11 fichiers (« Dix fichiers au plus »), panne d'écriture en 5xx, 409 brouillon et annulée sans dossier, 51e fichier en 409. À chaque refus : aucun fichier dans `uploads/missions/pod/mission-<id>/`, aucun texte busboy dans la réponse. Hygiène `multer-storage-hygiene` verte (aucune valeur de requête dans `filename`).
