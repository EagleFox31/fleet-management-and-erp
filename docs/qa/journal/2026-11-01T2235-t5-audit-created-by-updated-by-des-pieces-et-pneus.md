## 2026-11-01 - T5 : audit created_by / updated_by des pièces et pneus

**Quoi**
- `tests/integration/stock-audit-columns.test.ts` (9 tests) : création (created_by = updated_by = auteur), modification par un autre utilisateur (updated_by et updated_at changent, created_by et created_at non), ajustement de stock par un troisième (updated_by, mouvement d'entrée initial du créateur puis mouvement de l'ajustement), suppression logique d'un pneu, noms joints en lecture, pneu supprimé non modifiable.

**Pourquoi**
- AGENTS.md §5 : quatre champs d'audit obligatoires. Aucun test ne distinguait les auteurs.

**Preuve**
- Premier run : 1 rouge, erreur de mon attendu (le service écrit aussi un mouvement initial à la création : `[4200, 4202]`), attendu corrigé. Puis 9/9 deux fois de suite (idempotence). Pas de défaut produit trouvé, donc pas d'`it.fails` ni de rouge à prouver.

**Limites**
- Niveau service seulement : le contrat HTTP (corps client ignorant created_by) n'est pas couvert.

**Reste**
- T8 (pagination, filtres, recherche), T1, T3, T4.

