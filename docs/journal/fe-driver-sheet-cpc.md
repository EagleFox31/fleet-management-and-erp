# fe-driver-sheet-cpc

## Mise à jour du CPC depuis la fiche chauffeur

**Quoi.** `CPCUpdateForm` est rendu sur la fiche chauffeur (`client/src/pages/drivers/[id].tsx`, carte « Formation CPC »), uniquement si `canManageDrivers(user?.role)` (admin, logistique, secrétariat). Les autres rôles (driver, client, workshop_manager, etc.) ne voient rien.

**Comment.**
- Composant réutilisé tel quel (il porte déjà un seul chauffeur). Seul changement : la mutation reçoit l'identifiant par les variables (`mutate({ id, date })`) et l'envoi passe par `useSingleFlightMutate` (AGENTS.md §10). Les deux tableaux de bord qui l'utilisent en profitent sans changement d'usage.
- Les trois couches existaient déjà : invalidation par `invalidateDriverCpcDependents` (fiche, listes, statistiques CPC, missions, check-list de lancement) et événements `driver_cpc_updated` / `driver_cpc_statuses_synced` dans `useRealTimeSync.ts`, émis par `server/api/drivers.routes.ts`. Rien recréé.
- Garde d'affichage = garde de la route `POST /api/drivers/:id/update-cpc` (`isDriverManager`).

**Pourquoi.** Admin et logistique étaient autorisés par la route mais n'avaient aucun écran pour corriger un CPC.

**Tester.** `tests/unit/client/driver-sheet-cpc-visibility.test.ts` (visibilité par rôle, tous les rôles de l'application). À la main : se connecter en logistique, ouvrir une fiche chauffeur, onglet Informations, enregistrer une date ; en technicien, le formulaire est absent.

## À faire après fusion de #368

`getCpcBlockGuidance` (`client/src/lib/mission-wizard-rules.ts`) et `tests/unit/client/mission-wizard-cpc-guidance.test.ts` vivent dans la PR #368 (`fix/mission-wizard-cpc-message`), non fusionnée : non modifiés ici. Une fois #368 fusionnée, la consigne devra renvoyer vers « la fiche du chauffeur » pour admin et logistique (le secrétariat garde son tableau de bord).

## Hors périmètre vu

`client/src/pages/workshop-manager/dashboard.tsx:666` rend `CPCUpdateForm` alors que la route refuse `workshop_manager` (403 à l'enregistrement). À masquer ou à confier à un autre rôle ; non traité ici.

## Réserves de relecture (0a)

- **E2E** : `e2e/19-driver-space.spec.ts`, bloc DRV2-6. Session logistique sur `/drivers/:id`, onglet Informations, saisie d'une date, POST `update-cpc` 200, badge « FORMÉ » rafraîchi ; un observateur atelier reçoit la trame `driver_cpc_updated` (deux rôles, pas le polling). Second test : la direction (`management`) est refusée par la route `/drivers/:id` (`RoleRoute` sur `DRIVER_MANAGER_ROLES`) : « Accès refusé », aucun bouton. Tout visiteur de la fiche est donc déjà gestionnaire ; la garde `canManageDrivers` dans la page est une défense en profondeur. Lancé uniquement sur le Postgres local `fm-b7demo` (`DATABASE_URL=postgres://fleet:fleet@postgres:5432/fleet_test`, proxy `localhost:58433/v1`, serveur sur le port 5078).
- **Carte dans une carte** : prop `embedded` sur `CPCUpdateForm` (sans cadre, nom ni badge), utilisée sur la fiche ; dashboards inchangés. Ajout de `data-testid="cpc-update-form-<id>"`.
- **Suivi, non traité** : couleurs en dur (`bg-white`, `slate-*`, `emerald-*`, `purple-*`) dans `cpc-update-form.tsx`, à passer aux tokens du design system.
