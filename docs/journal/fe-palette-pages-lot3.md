# Palette : GMAO, demandes de piece, rapports de direction, fiche piece

## Quoi
Cliquet abaisse dans le meme commit : maintenance/gmao-dashboard 157 -> 81, inventory/requests 146 -> 79, management/reports 97 -> 36, inventory/[id] 124 -> 64. Reste = blue, orange, yellow, purple (exceptions categorielles).

## Comment
Memes jetons que les tranches precedentes. `inventory/requests` : couleurs seulement, aucun libelle de statut touche (AGENTS.md §1, source shared/constants/part-requirements.ts). `components/**` non touche (reconstruction en cours ailleurs). Controle grep : aucune classe a opacite double ; une `dark:border-warning/30/40` attrapee et corrigee avant commit (gmao-dashboard).

## Pourquoi
Un seul point de verite pour les couleurs semantiques.
