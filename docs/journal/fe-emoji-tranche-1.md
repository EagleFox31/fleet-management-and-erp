# Emoji dans l'UI : tranche 1

## Quoi
Dix fichiers de `client/src` sans emoji : icônes `lucide-react` à la place (vehicle-form, workflows d'acquisition, part-table, tutoriel achats, mileage-update-form, missions/new, dev/profiles) ; textes sans emoji (toasts de reports/index, use-animated-error), ⏳ de dev/profiles remplacé par Loader2.

La regex ignorait la plage U+23xx (⏰ ⏳) : étendue à U+231A-231B et U+23E9-23FA ; sans cela le premier énoncé « sans emoji » était faux pour use-animated-error:103 et profiles:196. Titre de toast « Accès refusé » devenu littéral : 3 getByText e2e passent en `exact: true` (toast-title-exact-hygiene). Compte gelé abaissé dans `no-emoji-in-ui.test.ts`.

## Reste gelé, hors écran (signalé, non migré)
console.* : technician/fleet-status (9), settings (7), use-workflow-persistence (2) ; commentaire : lib/form-drafts (1).

## Preuve
Emoji ajouté dans mileage-update-form : le test passe au rouge ; fichier restauré. `npm run check` : 0 erreur TS ; tests unitaires client : 621 verts.
