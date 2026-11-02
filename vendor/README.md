# vendor/

Archives de dépendances versionnées dans le dépôt (non publiées sur npm).

## xlsx-0.20.3.tgz (SheetJS CE 0.20.3, Apache-2.0)

- Source : https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- Pourquoi : la version npm `xlsx@0.18.5` est vulnérable sans correctif publié sur npm
  (CVE-2023-30533, pollution de prototype ; CVE-2024-22363, ReDoS). SheetJS ne publie plus sur npm.
- Référencée par `package.json` : `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` ; `package-lock.json` porte
  l'integrity sha512. Garde-fou : `tests/unit/server/xlsx-lockfile.test.ts`.
- Mise à jour : télécharger la nouvelle archive depuis cdn.sheetjs.com, remplacer le fichier, adapter le
  nom dans `package.json`, relancer `npm i`, mettre à jour le test garde-fou.

### Veille sécurité

Dependabot et `npm audit` ne suivent pas cette archive. Consulter régulièrement
https://cdn.sheetjs.com/advisories/ et la liste des versions sur https://cdn.sheetjs.com/ ;
toute nouvelle alerte exige une montée de version manuelle.
