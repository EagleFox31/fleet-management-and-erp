## 2026-11-06T13:12:00+01:00 — Pools Postgres : erreur d'une connexion au repos journalisée, sans arrêt du processus

- **Agent** : de (fleet-testeur) · **Branche** : `fix/db-pool-error-listener` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `server/db.ts` n'écoutait pas `error` sur `pool` ni `listenerPool`. Une connexion inactive qui casse (redémarrage de la base, coupure réseau) levait l'erreur et arrêtait le serveur. Relevé par la revue de sécurité de #582.
- **Comment** : `server/lib/db-pool-errors.ts` (`logPoolErrors`) journalise par `moduleLogger("db")` avec `{ err, pool }`. pg-pool a déjà retiré la connexion fautive, la suivante est neuve.
- **Comment tester (QA)** : `tests/unit/server/db-pool-errors.test.ts` :
  - témoin : sans écouteur, l'émission lève ;
  - l'écouteur journalise sans lever ;
  - le vrai `server/db` porte un écouteur sur chaque pool. Ce test est rouge sans le branchement dans `db.ts`.
  - Campagnes : unitaires 302/302, tsc 0, check:tests 0. Intégration 71/74 : les 3 échecs (timeouts de connexion sous rafale) se reproduisent à l'identique sur main pur, ils viennent du relais Docker et non de ce lot.
- **RAIDER** : R (un seul module pour les deux pools) ; D (aucun changement de comportement hors panne) ; E (log structuré, pas de `console.*`). Ne s'applique pas : I, Retroactive (pas d'état).
- **Reste / risques** : aucun ; une connexion en cours de requête renvoie toujours son erreur à l'appelant (inchangé).

