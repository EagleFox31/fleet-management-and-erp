## 2026-11-10 12:15 - POD : fichier résiduel après un multipart tronqué (course)

**Quoi.** Le contrat « multipart tronqué : 400 lisible, aucun fichier résiduel » était rouge par intermittence en CI (un fichier au lieu de zéro).

**Cause.** Sur une erreur busboy, multer ne connaît que les fichiers terminés. Le flux en cours d'écriture n'était pas détruit, et l'ouverture du descripteur par `createWriteStream` est asynchrone : le `rmSync` partait avant la création du fichier, qui apparaissait ensuite. Reproduit en local avec 40 répétitions (rouge sur l'ancien code).

**Comment.** `server/api/mission-pod.routes.ts` : stockage disque maison (`podStorage`) qui suit chaque flux dès son ouverture, détruit les flux sur erreur, attend leur fermeture (`close`) puis supprime les fichiers (`uploadedFileCandidates`) avant de répondre. Pas de quarantaine, pas de pause ni de nouvel essai.

**Preuve.** Test de contrat répété 40 fois dans une même exécution : rouge avant, vert après (3 exécutions du fichier, puis 2 avec le contrat lecteur). Gardes multer-lifecycle, multer-storage, uploaded-file et upload-delete verts.
