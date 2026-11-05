# Emoji dans l'UI : tranche 1

## Quoi
Dix fichiers de `client/src` sans emoji : icônes `lucide-react` à la place (vehicle-form, workflows d'acquisition, part-table, tutoriel achats, mileage-update-form, missions/new, dev/profiles) ; textes sans emoji (toasts de reports/index, use-animated-error). Compte gelé abaissé dans `no-emoji-in-ui.test.ts`.

## Reste gelé, hors écran (signalé, non migré)
console.* : technician/fleet-status (9), settings (7), use-workflow-persistence (2) ; commentaire : lib/form-drafts (1).

## Preuve
Emoji ajouté dans mileage-update-form : le test passe au rouge ; fichier restauré. `npm run check` : 0 erreur TS ; tests unitaires client : 621 verts.
