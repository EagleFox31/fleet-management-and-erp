# Garde de portée des diffusions temps réel : analyse AST

- Le contrôle par expression régulière laissait passer un appel dont le mot « scope » apparaissait ailleurs que dans la portée, et ne voyait pas les alias locaux (`const broadcast = global.broadcastUpdate`, `broadcast?.(…)`).
- `tests/unit/server/broadcast-hygiene.test.ts` analyse maintenant l'arbre syntaxique (compilateur TypeScript) : alias détectés, deuxième argument littéral, propriété `scope` avec un `type` littéral `roles`, `user` ou `broadcast`.
- Une portée calculée (variable, appel) n'est plus lisible à la revue : elle figure dans `OPAQUE_SCOPES` (fichier et nombre), liste qui ne peut que rétrécir.
- Mutations vues rouges : retrait de la portée de `mission_budget_updated` (appel signalé), portée calculée ajoutée (comptage dépassé).
- Deux échecs intermittents rencontrés en local, verts isolés, sans lien : `tests/unit/gitattributes-union.test.ts` (« docs/analysis/LESSONS_LEARNED.md fusionne en union ») et `tests/unit/hooks/agent-hooks.test.ts` (« garde-lecture-seule sort avec le code 2 (bloquant), pas 1 »). À signaler s'ils reviennent en CI, sans relance.
