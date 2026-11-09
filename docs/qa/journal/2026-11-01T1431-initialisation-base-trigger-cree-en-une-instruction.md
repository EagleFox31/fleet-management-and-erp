## 1fd9250 - Initialisation base : trigger créé en une instruction (fiabilité des suites)

**Quoi / Pourquoi**
- `DROP TRIGGER` puis `CREATE TRIGGER trg_sync_document_updated_by` : une initialisation concurrente
  échouait (« already exists »). Cas vécu : remplacer un fichier serveur pour jouer le rouge relance
  `tsx watch` (dev sur 5055) pendant le setup du contrat ; la suite s'arrête sans aucun test.

**Comment**
- `CREATE OR REPLACE TRIGGER` (PostgreSQL ≥ 14, Neon 17). Garde-fou `init-database-concurrency`
  (2 rouges sur l'ancien code) : aucun `CREATE TRIGGER` ni `DROP TRIGGER` nu dans l'init.

**Reste**
- Sécurité : `getRoleLabel` (5 rôles) ; T3 sur `server/routes.ts`.

