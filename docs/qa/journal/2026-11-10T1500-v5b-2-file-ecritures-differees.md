## 2026-11-10 15:00 - V5b-2 : cœur de la file d'écritures différées

**Quoi.** File v2 hors ligne générique (clé d'idempotence stable, FIFO avec arrêt, classement des réponses, verrou entre onglets, contrôle du propriétaire par `/api/auth/me`, registre d'invalidations, un seul resync après vidange, déconnexion bloquée avec « Supprimer N envois »). Aucun écran métier branché ; drapeaux `offline-writes` et `driver-offline` éteints par défaut.

**Preuve.** Tests unitaires `offline-queue-core`, `offline-replay-gate`, `offline-storage-scope`, `offline-storage-session` ; `tsc` global à zéro erreur.

**Reste.** V5b-3 (liste blanche chauffeur, bandeau), V5b-5 (constructeur multipart et magasin de fichiers).
