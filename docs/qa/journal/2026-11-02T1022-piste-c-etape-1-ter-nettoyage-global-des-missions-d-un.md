## Piste C, étape 1 ter : nettoyage global des missions d'un compte de test

**Quoi**
- `tests/support/cleanup.ts` supprime aussi les missions (et leurs factures client) créées par un compte de test orphelin avant de supprimer le compte.

**Pourquoi**
- Sur la branche de test, le hook global `afterAll` échouait (`missions_created_by_users_id_fk`) et marquait en échec la suite de chaque fichier de contrat, tests verts compris.

**Preuve**
- Avant : 3 suites en échec au hook, 10 tests verts. Après : plus d'échec de hook.

