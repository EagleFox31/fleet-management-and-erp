## d0cf7e8 - Niveaux E et UI : double clic, refus lisibles, actions selon le rôle (T7, T1, T3)

**Quoi**
- Un double clic sur « Confirmer » n'enregistre plus qu'un paiement client et qu'un ajustement de stock.
- Deux ajustements de stock simultanés s'additionnent ; un retrait au-delà du stock est refusé (409)
  au lieu d'être ramené à 0 ; un ajustement invalide donne un 400 lisible au lieu d'un 500 SQL.
- Couverture e2e de la priorité 1 dans le navigateur : double soumission (T7), 403 forgé au contrat
  d'erreur (T1), toast métier sans détail technique (T3), boutons selon le rôle (T1 UI).

**Comment**
- Niveau E d'abord (`e2e/07-double-submit-integrity.spec.ts`, `e2e/08-role-actions-and-error-toast.spec.ts`) :
  données créées par les fabriques de `tests/support` (un utilisateur par rôle, préfixe `TEST-`),
  connexion par `page.request` (`loginWithSession`), vérité lue en base, nettoyage en `afterAll`.
  `E2E_CHANNEL` rend le navigateur configurable (Edge installé, Chromium de Playwright absent).
- Le `dblclick` réel a révélé deux doublons (paiement sans référence, ajustement de stock) malgré
  `disabled={isPending}`. Garde synchrone `singleFlight` (unitaire d'abord, 3 cas) et hook
  `useSingleFlightMutate`, branchés sur les deux boutons. Rouge sans la garde (`git stash` du client), vert avec.
- L'e2e d'ajustement a aussi montré deux mouvements « 10 -> 13 » pour +3 en stock : intégration
  (`tests/integration/parts-stock-adjustment.test.ts`, 5 appels simultanés : rouge 12 au lieu de 15),
  puis service sous transaction et `FOR UPDATE`, `AppError` 400/404/409, `console.log` migrés vers
  `moduleLogger("parts")`.
- Route `POST /api/parts/:id/update-stock` : schéma Zod en français, `next(error)`. Seule modification
  de `server/routes.ts` : durcir une route existante, aucune route ajoutée (AGENTS.md §9).
- Contrat (`tests/contract/parts-stock-adjustment.contract.test.ts`, 8 cas) rejoué sans les correctifs
  serveur : 6 rouges (500 au lieu de 400/404, 200 au lieu de 409).
- Toast de l'ajustement via `userMessageOf`.
- Le test T3 UI échouait une fois sur deux : le 409 était bien affiché, puis remplacé en moins d'une
  seconde par une alerte temps réel (`alert_created` -> toast), car `TOAST_LIMIT` valait 1. Unitaire
  sur le réducteur (`tests/unit/client/toast-limit.test.ts`, rouge puis vert), limite passée à 3.
  Le test cible `li[role="status"]` : Radix double chaque toast d'un `span role="status"` pour
  les lecteurs d'écran, ce qui donnait deux éléments à un sélecteur par rôle.

**Pourquoi**
- `isPending` ne change qu'au rendu suivant : la protection n'était qu'affichée. Le serveur ne peut pas
  dédoublonner un paiement sans référence (décision de 9f9ca09), donc la garde client est la seule barrière
  pour ce cas.
- Un historique de stock qui ne correspond pas au stock rend tout inventaire faux sans erreur visible.
- Un message d'erreur effacé avant d'être lu n'est pas lisible : c'est le cas que seul l'e2e pouvait montrer.
- Le niveau UI vérifie ce que voit l'utilisateur ; le niveau C ne prouve pas qu'un toast est lisible ni
  qu'un bouton interdit est masqué.
- Incidents : LESSONS_LEARNED « Double clic : deux paiements, deux ajustements de stock » et
  « Ajustement de stock : mise à jour perdue, retrait plafonné en silence », « Toast d'erreur effacé
  par une alerte temps réel ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 391/391 ; `npm run test:integration` 45/45 ;
  `npm run test:contract` 61/61.
- e2e 07 (4 cas) et 08 (3 cas) verts contre la base de dev, serveur local sur 5055 ; T3 UI rejoué
  3 fois de suite après le correctif du toast (3/3) ; 0 ligne `TEST-` orpheline.
- Un échec intermédiaire venait d'un test d'intégration lancé en parallèle (purge des `TEST-`) :
  voir LESSONS_LEARNED « Near miss : purge de test qui casse un e2e en cours ».

