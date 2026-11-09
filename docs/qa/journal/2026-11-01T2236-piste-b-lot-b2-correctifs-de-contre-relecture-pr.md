## Piste B, lot B2 : correctifs de contre-relecture (PR #72)

**Quoi**
- `vehicles-crud` : le premier POST du doublon d'immatriculation est vérifié (201) avant le second ; les POST de création refusée, sans session et de corps invalide passent par un helper qui enregistre tout 201 inattendu dans `ids.vehicleIds`, pour le ménage.
- Références produit recalées dans les commentaires DEFAUT PRODUIT (elles corrigent l'entrée précédente) : `server/routes.ts:1090` devient 1092-1093, `:1195` devient 1193, `:1204` devient 1201.

**Preuve**
- `vehicles-crud` rejoué sous verrou et test d'hygiène `it-fails-hygiene` : résultats dans le compte rendu de la PR.

