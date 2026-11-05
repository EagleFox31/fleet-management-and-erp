# fe-token-success — jeton de couleur `success`

## Quoi
Ajout du jeton `--success` / `--success-foreground` (clair et sombre) dans `client/src/index.css` et du mapping `success` dans `tailwind.config.ts`, sur le modèle de `warning`.

## Comment
- Clair : `--success: 161 94% 24%`, foreground `0 0% 100%`.
- Sombre : `--success: 158 64% 52%`, foreground `240 10% 3.9%`.
- Contraste texte `success` sur `bg-success/10` (fond de page composé) : 4,85:1 en clair, 9,04:1 en sombre (seuil 4,5:1).

## Pourquoi
`client/src/components/ui/badge.tsx:20` utilise `bg-success/10 text-success` : sans jeton, Tailwind ne générait aucune règle et la variante était sans style. Seul autre usage : `client/src/components/vehicles/vehicle-form.tsx:402` (`text-success`, légende « Opérationnel »), qui passe de la couleur héritée au vert.

## Comment tester
`node node_modules/typescript/bin/tsc --noEmit -p .` ; `npm test` ; afficher un `Badge variant="success"` en thème clair puis sombre.

## Ajout : jeton `warning-text`

### Quoi
`--warning-text` (clair et sombre) dans `client/src/index.css` et mapping `warning.text` dans `tailwind.config.ts` (classe `text-warning-text`). `--warning` (38 92% 50%) est inchangé.

### Valeurs et ratios
Même méthode que `success` (WCAG 2.x, texte sur `bg-warning/10` composé sur `--background`, script Node jetable non versionné ; contrôle : success clair retrouve 4,85:1).
- Clair : `--warning-text: 32 95% 24%`, ratio 7,64:1 sur `bg-warning/10`. L'actuel `text-warning` (38 92% 50%) y fait 1,98:1, illisible.
- Sombre : `--warning-text: 38 92% 50%` (= `--warning`), ratio 8,20:1, pas de recalibrage.
- Le seuil 4,5:1 resterait tenu jusqu'à 34% de luminosité en clair (4,60:1) ; 24% garde de la marge.

### Usage recommandé
`bg-warning/10 text-warning-text` pour du texte sur fond teinté. `text-warning` reste pour les éléments décoratifs non textuels.

### Usages de `text-warning` à migrer (non modifiés ici)
- `client/src/components/ui/badge.tsx:22` (`bg-warning/10 text-warning`)
- `client/src/components/dashboard/alerts-panel.tsx:63` et `:65` (`bg-warning/10 text-warning`)
- `client/src/components/vehicles/vehicle-form.tsx:403` (`text-warning` sur fond de page)

### Comment tester
`node node_modules/typescript/bin/tsc --noEmit -p .` ; `npm test` ; afficher un `Badge variant="warning"` en thème clair puis sombre après migration.

## Migration des usages de `text-warning` vers `text-warning-text` (fix/warning-text-usages)

### Quoi
Quatre lignes basculées sur `text-warning-text` : `client/src/components/ui/badge.tsx:22`, `client/src/components/dashboard/alerts-panel.tsx:63` et `:65`, `client/src/components/vehicles/vehicle-form.tsx:403`. Rien d'autre.

### Comment (ratios WCAG, script Node jetable, `--background` clair 0 0% 100%, sombre 240 10% 3.9%)
- Clair, sur `bg-warning/10` : `text-warning` 1,98:1 -> `text-warning-text` 7,64:1.
- Clair, sur fond de page (légende du formulaire véhicule) : 8,24:1.
- Sombre, sur `bg-warning/10` : 8,20:1 ; sur fond de page : 9,31:1. En sombre `--warning-text` = `--warning`, donc aucun changement visuel et lisible.
- Recherche : aucun test ni snapshot sous `tests/` ne référence `text-warning`. Les consommateurs du variant `warning` du Badge reçoivent le correctif par la classe du variant, sans changement d'appel.

### Pourquoi
`text-warning` sur `bg-warning/10` était illisible en thème clair (1,98:1) ; le jeton `warning-text` de la PR #372 règle le contraste.

### Comment tester
`node node_modules/typescript/bin/tsc --noEmit -p .` (0 error TS) ; `npm test` ; afficher un Badge warning, le panneau d'alertes (sévérités moyenne/haute) et la légende du formulaire véhicule en clair puis en sombre.
