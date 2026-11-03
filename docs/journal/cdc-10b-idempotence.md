# Journal — CDC #10b, idempotence des écritures chauffeur

Branche `lot/api/CDC-10-idempotence`. Une entrée par commit : quoi, comment, pourquoi.

## 1. Garde d'idempotence (statut de mission, kilométrage)

- **Quoi** : un chauffeur hors ligne rejoue sa file d'écritures au retour du réseau. Une même
  écriture ne doit produire qu'un effet. Routes couvertes : `PUT /api/missions/:id/status`,
  `PUT /api/vehicles/:id/mileage`. Aucun mouvement de stock. La position n'a pas encore de route
  (télémétrie, lot #6).
- **Comment** : modèle du brouillon IETF « Idempotency-Key ». Le client envoie une clé par écriture ;
  `server/middleware/idempotency-guard.ts` la réserve dans `idempotency_keys` (unicité
  `user_id, key`), laisse la route s'exécuter, enregistre sa réponse, puis la rejoue telle quelle
  (en-tête `Idempotent-Replayed: true`) si la même requête revient. Même clé encore en cours : 409.
  Même clé pour un autre corps ou chemin : 422. Les 5xx, 401, 403, 408, 429 et les réponses
  interrompues libèrent la clé. Stockage indisponible : 503, rien n'est écrit. Clé restée en cours
  plus de 60 s (serveur arrêté) : reprise. Purge quotidienne des clés expirées (7 jours).
- **Pourquoi** : sans garde, un rejeu après une coupure pendant la réponse réécrit le kilométrage ou
  retransitionne une mission. Décision 0a (option B) : drapeau serveur `offline-writes`, indépendant
  du rôle ; `technician-offline` et `driver-offline` ne gouvernent que les écrans et l'exigent.
- **Choix (reuse-first)** : Adapt du brouillon IETF `draft-ietf-httpapi-idempotency-key-header` et du
  modèle Stripe (réponse enregistrée et rejouée, 409 si en cours, 422 si autre requête). Rejeté :
  dédoublonnage par contenu (deux saisies légitimes identiques seraient fusionnées).

## 2. Tests d'intégration et de contrat

- **Quoi** : `tests/integration/idempotency-store.test.ts` (9 cas sur Postgres réel) et
  `tests/contract/idempotency-driver-writes.contract.test.ts` (8 cas HTTP, comptes chauffeur).
- **Comment** : la preuve « non réexécutée » modifie la base entre les deux appels (compteur passé
  à 5000 km, mission remise à l'état précédent) : un second passage dans la route répondrait
  autrement. Vérifié rouge en désactivant le rejeu dans le garde (3 échecs), puis restauré.
- **Pourquoi** : un test qui rappelle seulement la route deux fois passerait aussi sans garde quand
  la route est déjà idempotente par nature.
