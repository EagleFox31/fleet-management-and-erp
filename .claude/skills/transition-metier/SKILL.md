---
name: transition-metier
description: Implémenter ou modifier une transition de statut métier dans Yaro FleetOS (ordre de travail, demande de pièce, commande fournisseur, facture, mission, véhicule). Applique la règle obligatoire des 3 couches — mise à jour locale, événement WebSocket, invalidation ciblée — avec les patterns réels du dépôt. À utiliser dès qu'une action change un statut, crée ou supprime une entité métier suivie par plusieurs profils.
---

# Transition métier — les 3 couches

`docs/analysis/LESSONS_LEARNED.md` rend ces trois couches **obligatoires**. Une
transition qui n'en livre que deux est un bug, même si l'écran de l'utilisateur
qui a cliqué semble correct.

1. **Instantané UI local** — le cache est mis à jour après succès de la mutation.
2. **Temps réel inter-profils** — un événement WebSocket dédié est émis.
3. **Resync ciblé** — invalidation du détail, de la liste **et des écrans satellites**
   (dashboards, KPI, compteurs, badges).

La couche 3 est celle qu'on oublie. Une transition validée sur la page courante
mais qui laisse le dashboard admin à l'ancienne valeur n'est pas terminée.

---

## Étape 1 — Situer la transition

Avant d'écrire du code, répondre à ces trois questions :

- **Quelle entité ?** `work_order`, `part_requirement`, `purchase_order`,
  `supplier_invoice`, `mission`, `vehicle`, `client_invoice`, `fuel_card`, `alert`.
- **Quels rôles doivent voir le changement ?** Si la réponse est « plus d'un »,
  le scope doit être `broadcast` (voir étape 2).
- **Le statut a-t-il un libellé UI ?** Si oui, il vient d'un fichier de constantes
  partagées, jamais d'une table locale. Pour les demandes de pièce :
  `shared/constants/part-requirements.ts`. Voir `AGENTS.md` section 1.

Vérifier si la transition existe déjà dans une machine à états. Pour les demandes
de pièce, `server/services/part-requirements-workflow.ts` centralise tout :

| Constante | Rôle |
|---|---|
| `STATUS_TRANSITIONS` | transitions autorisées depuis chaque statut |
| `STATUS_PERMISSIONS` | quels rôles peuvent faire quelle transition |
| `TRANSITION_DESCRIPTIONS` | libellé de l'action (ex. `Sortir la pièce du stock`) |
| `STATUS_RESPONSIBLE` | acteur métier attendu à chaque étape |
| `STATUS_LABELS` | réexport de `shared/constants/part-requirements.ts` |

Ne pas contourner ce fichier : ajouter la transition dans `STATUS_TRANSITIONS`
**et** ses droits dans `STATUS_PERMISSIONS`, sinon elle sera refusée à l'exécution.

---

## Étape 2 — Backend : émettre l'événement

**Ne jamais appeler `(global as any).broadcastUpdate` directement dans un handler.**
Chaque module de routes définit un helper local typé. Suivre ce pattern, calqué
sur `server/api/missions.routes.ts:21` :

```ts
function broadcastMissionUpdate(
  eventType: MissionRealtimeEvent,
  mission: Record<string, unknown>,
  extraPayload: Record<string, unknown> = {},
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  const missionId =
    typeof mission.id === "number"
      ? mission.id
      : Number.parseInt(String(mission.id ?? ""), 10) || null;

  broadcastUpdate(eventType, {
    entity: "mission",
    entityId: missionId,
    payload: { mission, missionId, ...extraPayload },
    scope: { type: "broadcast" },
  });
}
```

Points non négociables :

- Le garde `typeof broadcastUpdate !== "function"` : le serveur doit rester
  démarrable si le WebSocket n'est pas initialisé.
- `entity` et `entityId` explicites. Sans eux, `server/index.ts` les devine par
  préfixe d'événement, ce qui marche mal pour les entités nouvelles.
- L'objet métier complet dans `payload`, pas seulement l'id : le client s'en sert
  pour patcher son cache sans refetch.

### Nommage de l'événement

`<entite>_<action_au_participe_passe>` en snake_case :
`work_order_created`, `mission_status_changed`, `supplier_invoice_settlement_reconciled`.

### Le scope décide qui reçoit

`normalizeScope` dans `server/index.ts` :

| Scope | Effet |
|---|---|
| `{ type: "broadcast" }` | Toutes les sessions connectées |
| `{ type: "roles", roles: [...] }` | Seulement ces rôles |
| `{ type: "user", userIds: [...] }` | Seulement ces utilisateurs |

**Piège** : appeler `broadcastUpdate(event, data, userId)` avec un 3ᵉ argument
restreint l'événement à ce seul utilisateur. Une transition suivie par plusieurs
profils ne doit jamais faire ça — c'est ce qui casse le suivi inter-profils.
En cas de doute, `broadcast`.

### Alternative : le trigger PostgreSQL

Pour une transition qui peut aussi survenir hors API (script, SQL direct), il
existe un second canal : `pg_notify('fleet_events', ...)` depuis un trigger,
relayé vers le WebSocket par `server/index.ts`. Modèles dans
`server/db/triggers/`. Les événements issus des triggers sont **toujours** en
scope `broadcast`. Ne pas doubler inutilement : si la transition passe forcément
par l'API, le helper suffit.

---

## Étape 3 — Frontend : traiter l'événement

Dans `client/src/hooks/useRealTimeSync.ts`, ajouter un `case` dans le switch sur
`update.type`. Deux stratégies, à combiner :

**Patcher le cache** quand l'objet complet est dans le payload — mise à jour
immédiate, sans aller-retour réseau :

```ts
case "mission_status_changed": {
  const mission = extractMissionFromPayload(payload);
  if (mission) {
    patchMissionCaches(mission, false);
  }
  invalidateMissionDerivedQueries(missionId);
  break;
}
```

Helpers existants : `patchWorkOrderCaches`, `patchMissionCaches`,
`patchVehicleDocumentInCacheData`, `invalidateMissionDerivedQueries`.

**Invalider** les queries dérivées qu'on ne peut pas recalculer localement
(agrégats, statistiques, compteurs).

### Recenser les écrans satellites

C'est l'étape qui fait échouer les revues. Pour chaque transition, lister
explicitement les queries à invalider :

- le **détail** de l'entité — `/api/missions/:id`
- la **liste** — `/api/missions`
- les **statistiques** — `/api/work-orders/statistics`, `/api/statistics/fleet-kpi`
- les **dashboards par rôle** qui affichent un compteur lié
- les **badges et alertes** — `/api/alerts`, `/api/alerts/count`

Pour les clés dynamiques, utiliser un `predicate` plutôt que d'énumérer les ids,
comme dans `invalidateMissionDerivedQueries`.

---

## Étape 4 — Vérifier

La checklist de `LESSONS_LEARNED.md`, à passer réellement :

1. L'utilisateur qui déclenche l'action voit la mise à jour sans refresh.
2. **Un autre profil connecté** voit la mise à jour sans refresh.
3. Les badges, KPI et listes liés sont cohérents.
4. Le détail et la liste affichent le même statut métier.
5. Les logs backend montrent l'étape métier et l'événement émis.

### Piège préalable : deux `QueryClient`

Si **rien** ne se met à jour en temps réel — pas seulement l'écran que vous
modifiez — vérifiez d'abord que `queryClient` est importé partout par l'alias
`@/lib/queryClient`, jamais par chemin relatif. Vite instancie sinon le module
deux fois, et toute la couche 3 écrit dans un cache que personne ne rend.

Symptôme : une latence d'affichage à peu près égale à un `refetchInterval`.
Vérification en deux lignes, dans le handler concerné :

```ts
console.log(queryClient.getQueryCache().getAll().length); // 0 => mauvaise instance
```

Historique complet dans `docs/analysis/LESSONS_LEARNED.md` (18 août 2026).

### Piège de vérification : le polling

Plusieurs listes se rafraîchissent seules via `refetchInterval` (7 s sur
`client/src/components/maintenance/work-order-table.tsx`). Une assertion « ça
finit par apparaître » au-delà de cet intervalle est satisfaite par le polling
seul et **ne prouve rien** sur le temps réel.

Pour vérifier vraiment :

- observer la **trame WebSocket** reçue par la session observatrice
  (`page.on("websocket")` en Playwright), pas seulement le rendu ;
- jouer **deux comptes de rôles différents** — jamais deux onglets du même
  utilisateur, sinon le scope n'est pas exercé.

Modèle complet : `e2e/06-realtime-work-orders.spec.ts`. Détails dans
`e2e/README.md`, section « Piège à connaître ».

---

## Anti-patterns

- Ajouter une mutation sans événement temps réel.
- Émettre avec un `userId` en 3ᵉ argument pour une transition multi-profils.
- N'invalider que la page courante et oublier dashboards, compteurs et stats.
- Afficher un statut technique brut dans l'UI (`awaiting_parts`, `issued`) au lieu
  du libellé métier issu des constantes partagées.
- Redéclarer une table de libellés en local — il en existait quatre pour les
  demandes de pièce, elles avaient divergé.
- Ajouter la route dans `server/routes.ts` : ce fichier fait ~5 700 lignes et
  contient déjà des routes dupliquées. Créer un module dans `server/api/`.
