# Trésorerie T2/T3 : pleins, recharges et règlements fournisseur au journal

## 5 novembre 2026

### Quoi
- **T2, carte carburant** : un plein payé par carte écrit une sortie sur le compte `fuel_card`, et une recharge écrit une entrée. Si le compte source est indiqué (`sourceAccountId`), la recharge écrit aussi la sortie correspondante, avec le même groupe de virement.
- **T3, règlement fournisseur** : quand le règlement porte `treasuryAccountId`, il écrit une sortie sur ce compte. Le rejet du règlement écrit la contre-passation.
- **Lecture logistique** : le rôle logistique lit les comptes et le livre, mais seulement ceux de la carte carburant ; un autre compte renvoie 403.
- **Contraintes** : les CHECK et UNIQUE de trésorerie sont réconciliées au démarrage, sur le modèle du schéma CDC (#122). Elles portent les mêmes noms dans Drizzle, dans le SQL et dans `TREASURY_RECONCILED_CONSTRAINTS`.

### Comment
- `server/services/treasury-links.ts` : chaque écriture liée s'insère dans la transaction de l'opération source. Sa clé est dérivée de la source :

  | Écriture | Clé |
  |---|---|
  | Plein ou recharge | `fuel:<id>` |
  | Sortie du compte source d'une recharge | `fuel:<id>:source` |
  | Règlement fournisseur | `settlement:<id>` |
  | Contre-passation d'un rejet | `settlement:<id>:reject` |

  L'insertion se fait en `ON CONFLICT DO NOTHING`, donc un rejeu ne crée jamais de doublon.
- Il ne peut exister qu'une carte carburant active, garanti par `uq_treasury_accounts_active_fuel_card`. Les pleins savent ainsi sans ambiguïté sur quel compte écrire.
- Le rejet d'un règlement et sa contre-passation se font dans une seule transaction.
- Réconciliation des contraintes :
  - bloc `DO` en fin de `TREASURY_SCHEMA_STATEMENTS` ;
  - CHECK posée en `NOT VALID`, puis `VALIDATE` ;
  - UNIQUE renommée si elle existe sous un autre nom, par exemple le nom Drizzle par défaut `treasury_accounts_code_unique` ;
  - avertissement plutôt que démarrage bloqué en cas de doublons ;
  - `reportCdcConstraintGaps` prend désormais la liste en paramètre.
- La nouvelle CHECK `treasury_entries_category_check` est construite depuis `TREASURY_CATEGORIES` : il n'y a pas de copie de la liste à tenir à jour.

### Pourquoi
- Une écriture liée est toujours annulée avec son opération source : pas de ligne orpheline, pas de plein sans écriture.
- Sans réconciliation, une base créée par `drizzle-kit push` aurait gardé des noms d'unicité différents (`_unique` au lieu de `_key`). La prochaine poussée aurait alors posé une seconde contrainte.

### Suites connues
- La suppression d'un plein laisse son écriture de trésorerie, dont le lien passe à `NULL`. Il faudra décider de la contre-passer.
- L'écran de choix du compte source d'une recharge reste à faire ; l'API l'accepte déjà.
