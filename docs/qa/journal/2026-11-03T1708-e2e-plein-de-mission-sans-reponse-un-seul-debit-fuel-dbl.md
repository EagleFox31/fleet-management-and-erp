## 2026-11-03 17:08 — e2e : plein de mission sans réponse, un seul débit (FUEL-DBL)

- **Quoi** : `e2e/21-mission-fuel-double-debit.spec.ts`.
  - Le chauffeur valide un plein.
  - `page.route` laisse la requête atteindre le serveur, qui écrit le plein (`route.fetch`), puis jette la réponse (`route.abort`).
  - Le chauffeur ferme la fiche (Annuler), la rouvre et renvoie le même plein.
  - Attendu : même `requestKey` aux deux envois, rejeu en 2xx, un seul débit en base pour la mission.
- **Pourquoi** : niveau E de #181.
  - Les contrats prouvent le rejeu côté serveur.
  - Seul un navigateur prouve que la clé survit à une issue inconnue et à la fermeture de la fiche (sessionStorage, `discard` qui garde une clé incertaine).
- **Preuves** :
  - vert sur Postgres local, serveur sur un port dédié, Chrome (`E2E_CHANNEL=chrome`) ;
  - rouge quand `discard` libère aussi une clé incertaine : le renvoi part avec une nouvelle clé ;
  - vert de nouveau après retour arrière ;
  - tsc 0.

