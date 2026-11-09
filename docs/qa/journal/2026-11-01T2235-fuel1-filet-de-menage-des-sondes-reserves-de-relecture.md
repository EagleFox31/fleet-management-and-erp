## 2026-11-01 - FUEL1 : filet de ménage des sondes (réserves de relecture #74)

**Quoi** : `probe()` enregistre l'id avant la suppression ; `afterAll` balaie `fuel_records` daté de 2031.
**Pourquoi** : un débit NaN resté en base fausse le solde global de la carte pour tous les fichiers (voir LESSONS_LEARNED).
**Preuve** : fichier rejoué, 40/40 verts sur la base `tests-piste-a`.
**Reste** : T8.

