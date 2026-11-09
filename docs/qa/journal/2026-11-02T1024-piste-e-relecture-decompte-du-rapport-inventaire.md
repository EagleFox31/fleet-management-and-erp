## Piste E, relecture : décompte du rapport inventaire

**Quoi**
- Entrée « Piste E » : `reports-inventory-period` compte 5 cas + 3 `it.fails`, pas 6 + 3.

**Comment**
- Décompte des `it(` et `it.fails(` du fichier (5 et 3) ; le total 26/26 sur les quatre fichiers est cohérent avec 8 + 8 + 6 + 4.

**Pourquoi**
- Un chiffre faux dans le journal affaiblit les autres.

**Preuve**
- `grep -c` sur le fichier de contrat : 5 `it(`, 3 `it.fails(`.


