## Lecteur : libre-service autorisé, rôle normalisé, boutons d'écriture masqués

**Quoi** : corrections de relecture et de sécurité sur le rôle Lecteur (`viewer`).
- `VIEWER_WRITE_ALLOWED` passe de 1 à 9 entrées : ouverture et fermeture de session (`login`,
  `pin-login`, `logout`), mot de passe, parcours d'accueil (`step`, `complete`, `mascot`),
  préférences de notification, lecture d'une alerte (`PATCH /alerts/:id/read`, filtrée par
  `userId` côté route). `matchesAllowedWrite` compare segment par segment (`:id`).
- La garde normalise le rôle (`normalizeRole`) : un rôle stocké « Viewer » ou « lecteur » est
  refusé comme `viewer`. Elle réutilise `req.user` quand une garde amont l'a chargé.
- Client : `isReadOnlyRole(user)` (`client/src/lib/read-only-role.ts`, dérivé de
  `READ_ONLY_ROLES`) masque les exports de Rapports et « Ajouter un OT ». Le toast d'export
  affiche `userMessageOf(error, …)`. Landing : 11 profils, matrice « Maintenance & OT » alignée
  sur le menu (faux pour le lecteur).

**Comment** : contrat sur la pile Express complète, décomptes figés en égalité
(`EXPECTED = { apiRouter: 143, registerRoutes: 38, horsApi: 0, total: 177 }`), cinq contrats
libre-service en 200, unitaire de la garde avec `findActiveSessionUser` bouchonné.
Rouge montré une fois en court-circuitant la garde localement (non commité) : les 177 routes
d'écriture répondent 403 « Accès non autorisé » / 404 / 400 au lieu du message de lecture seule.

**Pourquoi** : un lecteur doit pouvoir changer son mot de passe, finir son accueil et marquer
ses alertes sans que ces écritures soient des écritures métier ; un rôle stocké avec une
majuscule passait `isStaff` mais pas la garde ; un bouton qui finit en 403 est une erreur d'UI.

**Preuve** :
- `npm run -s check` 0, `npm run -s check:tests` 0.
- `node ./node_modules/vitest/vitest.mjs run tests/unit/server/viewer-read-only-guard.test.ts tests/unit/shared/viewer-role.test.ts tests/unit/client/screen-route-roles.test.ts tests/unit/server/prefix-middleware-guardrail.test.ts` : 60/60.
- `npm run -s test:contract -- viewer-read-only accountant-role-guards billing-revenue-by-client` (Postgres local) : 10 + 22 + 21 = 53/53.
