## 2026-11-03 12:55 — Portée temps réel fermée par défaut

- **Quoi** : une portée WebSocket absente, vide ou invalide n'envoie plus rien (avant : broadcast à tous, clients compris, cause commune de #53, #127 et #151). Le broadcast n'existe que si `type: "broadcast"` est écrit.
- **Comment** : `normalizeScope` et le choix des destinataires sortent de `server/index.ts` vers `server/lib/realtime-scope.ts` (module pur, index de connexions injecté). Les appels sans portée (20 points d'émission) (OT, demandes de pièce, réception) sont rendus explicitement broadcast ; l'inventaire des appels est dans la PR.
- **Pourquoi** : le défaut ouvert transformait toute portée calculée vide en fuite ; fermer à la source vaut mieux que corriger appelant par appelant.
- **Preuves** : `tests/unit/server/realtime-scope.test.ts` (23 cas), rouge sur la règle copiée de main (16 échecs), vert sur la nouvelle ; `tests/unit/server/broadcast-hygiene.test.ts` (3 cas), rouge démontré par l'ajout d'un `type: "broadcast"`. Liste gelée : 41 occurrences dans 25 fichiers.

