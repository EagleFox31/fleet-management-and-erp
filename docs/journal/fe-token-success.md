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
