## Piste D, étape 2 : WO6, bord de mois, d'année et fuseau des pointages

**Quoi**
- `tests/integration/time-tracking-month-boundary.test.ts` (10 cas) : 31 mars / 1er avril, 31 décembre / 1er janvier (l'année change avec le mois), 29 février bissextile, rejeu du dernier jour du mois sans doublon, et le jour saisi relu à l'identique sous TZ = Kiritimati (+14), Pago Pago (-11), Los Angeles, UTC. Année 2033, aucune autre suite n'y écrit. Nettoyage des lignes et du compte créés.
- 2 `it.fails` (défaut produit) : 30 février et 29 février 2033 ne sont pas refusés en 400.
- Plan : WO6 mis à jour.

**Comment**
- Branche Neon `tests-piste-c`, sous `db-lock`. `month` et `year` sont tirés de la chaîne reçue (`time-tracking-service.ts:28`), jamais d'un `Date` : le fuseau du processus est sans effet, le test le fige.

**Pourquoi**
- WO6 notait « bord de mois et fuseau non testés ».

**Preuve**
- 13/13 verts avec les 3 cas existants (premier essai : délai de 10 s des hooks dépassé sur la branche froide, relancé avec 60 s). Les 2 `it.fails` passent donc la date impossible lève une erreur qui n'est pas un 400. Pas de rouge sur la version fautive pour les cas de bord : il n'y a pas de défaut de bord, ce sont des garde-fous de comportement correct. Second passage (idempotence) non rejoué faute de tours : nettoyage en `afterAll`.
- Défaut : `shared/contracts/common.ts:12` (`isoDateSchema` ne vérifie que la forme) puis `server/services/time-tracking-service.ts:27` (`::date` en SQL) : erreur de base au lieu de 400. Correctif à fleet-api.

