## Garde-fou d'hygiène : it.fails sans mise en place

**Quoi**
- `tests/unit/server/it-fails-hygiene.test.ts` (5 cas) : extrait les `it.fails` / `test.fail` de `tests/` et `e2e/`, signale ceux dont le corps crée des données ou fait plusieurs requêtes. Huit occurrences héritées de main sont gelées.

**Comment**
- Analyse de texte (commentaires retirés, chaînes respectées), sans base. Une fabrique dont le résultat est assertionné sur `.status` est l'appel visé et n'est pas signalée, pour éviter les faux positifs.

**Pourquoi**
- `it.fails` passe sur n'importe quel échec : cinq PR ont dû être recalées (#67, #68, #70, #71, #72).

**Preuve**
- `it.fails` fautif fabriqué : rouge ; propre : vert. Fichier fautif déposé sur disque : 1 failed, retiré : 5/5.

