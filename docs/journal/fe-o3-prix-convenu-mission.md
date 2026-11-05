# O3 lot 3 : prix convenu à la création d'une mission

## Quoi
`GET /api/tariff-grid/suggest` est branché sur l'étape 2 de `missions/new.tsx`. Deux colonnes nullables sur
`missions` : `agreed_price numeric(15,0)` et `tariff_grid_id` (FK vers `tariff_grid`, `ON DELETE SET NULL`).

## Comment
- Schéma, `init-database.ts` (verrou, `lock_timeout`, FK `NOT VALID` puis `VALIDATE`), migration jumelle et
  test de dérive : même patron que #122. Pas de seed, pas de rattrapage des missions existantes.
- `POST /api/missions` : prix entier XAF borné, tarif d'origine exigeant un prix, tarif inconnu refusé en 400.
- Client : helper pur `lib/tariff-suggestion.ts`, encart `components/missions/tariff-suggestion-panel.tsx`,
  visible pour `canSetMissionPrice` (gestionnaires de missions qui lisent la grille).

## Pourquoi
- Le prix suggéré est affiché, jamais appliqué seul : il n'est enregistré que si l'utilisateur l'a saisi ou a
  cliqué « Utiliser ». Une saisie manuelle efface le lien vers le tarif.
- Les adresses de mission sont du texte libre, les tarifs des noms de lieu : repli sur la ville (texte avant
  la première virgule), signalé par « correspondance sur la ville ».
- À la tonne, « Utiliser » propose prix × poids si le poids est connu, sinon le prix du tarif.
- Pas d'événement WebSocket : la création de mission émet déjà le sien, le prix n'est pas une transition.
- `useSingleFlightMutate` sur la création : inchangé.

## Reste (lot 3b)
Modification du prix sur `[id].tsx` : `updateMissionSchema` est une liste blanche, `agreedPrice` n'y est pas
inscriptible aujourd'hui. PR séparée.

## Revue #487 : réserves R1 / R2 levées
- R1 : `server/lib/mission-price-scope.ts` expurge `agreedPrice` / `tariffGridId` (clés à null) pour les non-lecteurs de la grille ; appliqué aux routes operations, au PUT status et à la trame WS (jamais de prix en diffusion).
- R2 : le tarif cité à la création doit être actif, du client (ou générique) et couvrir la date de prise en charge ; l'écran détache le tarif repris si client, trajet, marchandise ou date changent.
- Mineurs : `AppError` au lieu de `res.status(400)`, `useSingleFlightMutate` sur la création, `ADD COLUMN` testé via `information_schema` avant de verrouiller.
