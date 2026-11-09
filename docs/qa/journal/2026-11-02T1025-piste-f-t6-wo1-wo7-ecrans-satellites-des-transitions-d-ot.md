## Piste F : T6, WO1, WO7, écrans satellites des transitions d'OT

**Quoi**
- `e2e/15-realtime-work-order-satellites.spec.ts` : (1) chef d'atelier et technicien créés par la spec ; création, démarrage, fin (technicien), correction (chef), refus création/suppression au technicien (403), suppression (chef). Chaque étape : trame WebSocket chez l'autre rôle ET refetch de `/api/work-orders/statistics` (et de la liste) observé (requêtes horodatées de la page) chez le chef, en moins de 5 s. (2) WO7 : `test.fail` « le chef reçoit l'alerte Intervention démarrée » avec témoin.

**Comment**
- Le tableau de bord du chef n'a pas de polling (`refetchInterval: false`, staleTime 5 min) : un refetch ne peut venir que de l'invalidation. Serveur local port 5072 et Playwright sur la branche Neon `tests-piste-c` (URL en variable d'environnement), sous `db-lock`. Mise en place du `test.fail` en `beforeAll`, le corps ne contient que la lecture des alertes.

**Pourquoi**
- T6 notait « invalidation KPI non vérifiée », WO7 « pas d'alerte nominative vers le chef ».

**Preuve**
- Vert : 3/3 en deux passages consécutifs (rouge reconfirmé après passage des attentes de refetch en requêtes horodatées, un premier essai avait échoué sur une création lente de la base distante). Rouge : retrait temporaire de l'invalidation `/api/work-orders/statistics` dans `work_order_updated` (`useRealTimeSync.ts`) : échec à l'attente du refetch après le démarrage (spec ligne 132) ; mutation annulée, `git diff client` vide.
- Défaut (test.fail, correctif à fleet-api) : `server/api/technician-work-orders.routes.ts:96` diffuse `work_order_updated` mais n'appelle pas `alertService.notifyWorkOrderProgress` (seul `server/routes.ts:2321` le fait) : pas d'alerte pour le chef quand le technicien démarre depuis son écran.
- Non couvert : MIS1/P2 (affectation, étapes, lancement de mission au navigateur) faute de tours.

