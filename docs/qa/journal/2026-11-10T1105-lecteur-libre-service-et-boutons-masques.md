## Lecteur : libre-service autorisé, rôle normalisé, boutons d'écriture masqués

**Quoi** : corrections de relecture et de sécurité sur le rôle Lecteur (`viewer`).
- `VIEWER_WRITE_ALLOWED` passe de 1 à 9 entrées : ouverture et fermeture de session (`login`,
  `pin-login`, `logout`), mot de passe, parcours d'accueil (`step`, `complete`, `mascot`),
  préférences de notification, lecture d'une alerte (`PATCH /alerts/:id/read`, filtrée par
  `userId` côté route). `matchesAllowedWrite` compare segment par segment (`:id`).
- La garde normalise le rôle (`normalizeRole`) : un rôle stocké « Viewer » ou « lecteur » est
  refusé comme `viewer`. Le rôle est toujours relu depuis la session : `req.user` n'est pas
  réutilisé (aucun middleware ne le pose avant la garde, et il ne garantirait pas de correspondre à
  `req.session.userId`). `normalizeRole` vit désormais dans `shared/constants/roles.ts`
  (ré-exporté par `server/middleware/auth.ts`) ; `isReadOnlyRole` normalise de la même façon.
- Client : `isReadOnlyRole(user)` (`client/src/lib/read-only-role.ts`, dérivé de
  `READ_ONLY_ROLES`) masque les exports de Rapports et « Ajouter un OT ». Le toast d'export
  affiche `userMessageOf(error, …)`. Centre d'alertes : « Tout marquer lu » et « Supprimer »
  masqués au lecteur (refusés par la garde). Landing : 11 profils partout, matrice
  « Maintenance & OT » à vrai pour le lecteur.

**Décision métier (0a, 2026-11-10)** : le lecteur consulte les coûts des ordres de travail, la
valorisation du stock et les coûts d'exploitation (consultation de direction). Il ne lit ni les
données personnelles des chauffeurs (CNI, permis), ni la trésorerie, ni la facturation. Il n'écrit
rien de métier ; seul le libre-service sur sa propre ligne lui reste ouvert.

**Comment** : contrat sur la pile Express complète, décomptes figés en égalité
(`EXPECTED = { apiRouter: 143, registerRoutes: 38, horsApi: 0, total: 177 }`), contrats
libre-service en 200 (étape, mascotte et fin d'accueil, préférences, alerte lue, mot de passe,
fermeture puis réouverture de session avec le nouveau mot de passe) ; `pin-login` passe la garde et
c'est la route qui répond 401 (chauffeurs seulement). Unitaire de la garde avec
`findActiveSessionUser` bouchonné ; unitaire `matchesAllowedWrite` sur les chemins piégés
(casse, double barre, segment en plus, traversée, point-virgule, autre méthode).
Rouge montré une fois en court-circuitant la garde localement (non commité) : les 177 routes
d'écriture répondent 403 « Accès non autorisé » / 404 / 400 au lieu du message de lecture seule.

**Pourquoi** : un lecteur doit pouvoir changer son mot de passe, finir son accueil et marquer
ses alertes sans que ces écritures soient des écritures métier ; un rôle stocké avec une
majuscule passait `isStaff` mais pas la garde ; un bouton qui finit en 403 est une erreur d'UI.

**Preuve** :
- `npm run -s check` 0, `npm run -s check:tests` 0.
- `node ./node_modules/vitest/vitest.mjs run tests/unit/server/viewer-read-only-guard.test.ts tests/unit/shared/viewer-role.test.ts tests/unit/client/screen-route-roles.test.ts tests/unit/server/prefix-middleware-guardrail.test.ts` : 60/60.
- `npm run -s test:contract -- viewer-read-only accountant-role-guards billing-revenue-by-client` (Postgres local) : 10 + 22 + 21 = 53/53.
