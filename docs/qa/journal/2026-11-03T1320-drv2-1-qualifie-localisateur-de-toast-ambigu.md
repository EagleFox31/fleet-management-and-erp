## 2026-11-03 13:20 — DRV2-1 qualifié : localisateur de toast ambigu

- **Quoi** : DRV2-1 (spec 19) n'est plus instable. `getByText("Problème signalé", { exact: true })` ; le corps de la réponse figure dans le message d'échec (lu seulement en échec, borné à 5 s). Nouveau garde `tests/unit/e2e/toast-title-exact-hygiene.test.ts`.
- **Comment** : base locale dédiée `fleet_test_c7`, serveur sur le port 5177, msedge. Rejeux spec 19 ×5 puis 13 + 19 ×3 : 147 verts, rouge non reproduit. Reproduit ensuite 1 fois sur 3 avec trace : POST 201, toast affiché, `strict mode violation` (titre + `<span aria-live>` du Toast Radix).
- **Pourquoi** : `getByText` sans `exact` cherche une sous-chaîne ; l'annonce passagère « Notification Problème signalé… » la contient. Défaut du test, pas du produit.
- **Preuves** : garde rouge sur la spec d'origine (`e2e/19-driver-space.spec.ts:196`), vert après ; spec 19 ×5 après correctif (voir PR) ; tsc 0.
- **Piège** : `response.text()` sur une réponse servie via le service worker PWA ne rend jamais la main (test bloqué 180 s sur un 201).

