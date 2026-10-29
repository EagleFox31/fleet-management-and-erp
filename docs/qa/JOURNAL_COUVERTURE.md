# Journal de la campagne de couverture

Trace de chaque étape de la priorité 1 de `PLAN_COUVERTURE_MODULES.md` :
**ce qui a été fait, comment, et pourquoi**, avec la preuve associée.

- Les incidents (cause racine, prévention) vivent dans `docs/analysis/LESSONS_LEARNED.md` ;
  ce journal y renvoie au lieu de les recopier.
- Une entrée par commit, la plus récente en bas.
- Méthode constante : test rouge d'abord, correctif minimal, suites complètes
  (`npm run check`, `npm test`, `npm run test:contract`), puis docs et commit.

Codes de tests utilisés (voir le plan) : **T1** 401/403 par rôle, **T3** 400 lisible
sur corps invalide, **T4** champs tenus par le serveur ignorés, **T7** double
soumission sans doublon.

---

## 6237cb3 - Matrice RBAC et ratchet des schémas d'insertion

**Quoi**
- Test unitaire de chaque middleware de rôle (`isAdmin`, `isWorkshopManager`, …)
  contre chaque rôle de `ALL_APP_ROLES`.
- Ratchet sur les schémas d'insertion Zod : liste des champs tenus par le serveur
  (`createdBy`, `updatedBy`, `createdAt`, …) qui ne doivent pas être acceptés du client ;
  17 exceptions existantes gelées.

**Comment**
- Niveau unitaire (sans base), les rôles dérivés de `shared/constants/roles.ts`.
- Le ratchet échoue si une nouvelle exception apparaît ; il passe quand une
  exception disparaît, il faut alors la retirer de la liste.

**Pourquoi**
- Base de la pyramide : vérifier les règles d'accès sans base de données, en millisecondes.
- Ratchet plutôt que tout corriger d'un coup : on empêche d'aggraver la dette sans
  bloquer le travail en cours.

## a20b181 - Contrat d'erreur centralisé et logger structuré

**Quoi**
- Contrat `ApiErrorBody { message, code, requestId, errors? }` (`shared/errors.ts`).
- `AppError` (`server/lib/app-error.ts`) et gestionnaire central
  (`server/middleware/error-handler.ts`).
- Logger pino `moduleLogger` (`server/lib/logger.ts`) ; `clientLogger` et
  `userMessageOf` côté navigateur (`client/src/lib/api-error.ts`).

**Comment**
- Le gestionnaire central normalise toute réponse >= 400, y compris les anciens
  `res.status(400).json({ message })` des routes : pas de réécriture route par route.
- Une 5xx affiche un message générique + « Référence : <requestId> » ; le détail ne
  part qu'aux logs, retrouvable par ce `requestId`.

**Pourquoi**
- Des messages techniques (SQL, stack) arrivaient dans les toasts.
- Un utilisateur qui signale une erreur peut donner une référence exploitable.
- Incident : LESSONS_LEARNED « Erreurs techniques affichées, logs supprimés ».

## 179015d - Réception et sortie de pièce idempotentes (T7 stock)

**Quoi**
- Une double soumission de « Sortir la pièce du stock » ne décrémente plus deux fois.

**Comment**
- Compare-and-set sur le statut dans `updatePartRequirement` ; l'effet stock passe
  dans `onTransition(tx)`, dans la même transaction que le changement de statut.
- Garde `quantity >= n` dans l'`UPDATE` du stock.

**Pourquoi**
- Deux clics rapprochés ou un retry réseau produisaient deux mouvements de stock.
- Incident : LESSONS_LEARNED « Sortie de stock vers l'OT : double sortie possible ».

## ffb87e5 - 403 par rôle et 400 lisible sur les POST principaux (T1, T3)

**Quoi**
- Test de contrat `tests/contract/api-role-guard-and-validation.contract.test.ts` :
  7 POST (OT, véhicule, demande de pièce, commande, facture fournisseur, fournisseur,
  client). Rôle interdit -> 403 au contrat ; rôle autorisé + corps vide -> 400 lisible.
- Correctifs : Zod sur le POST demande de pièce ; `ZodError` -> `next()` dans clients.

**Comment**
- Sessions réelles par `POST /api/auth/login`, un utilisateur `TEST-` par rôle.
- `expectErrorContract` refuse tout motif technique (`stack`, `SQLSTATE`, `violates`, …).
- Corps vides : aucune écriture en base.

**Pourquoi**
- Deux routes renvoyaient 500 « Erreur serveur » sur un corps incomplet : l'utilisateur
  ne savait pas quel champ corriger.
- Incident : LESSONS_LEARNED « Corps invalide renvoyé en 500 ».

## e76918c - PATCH véhicule et OT, statut forcé à la création d'une demande (T3, T4)

**Quoi**
- `server/lib/column-validation.ts` : `prepareColumnUpdate(table, body)`.
- PATCH véhicule et OT branchés dessus ; POST demande de pièce force `pending`.
- Nettoyage des tests : purge des alertes avant les utilisateurs `TEST-`.

**Comment**
- Les routes historiques de `server/routes.ts` n'ont pas de schéma Zod : le contrôle
  est **dérivé des colonnes Drizzle** (entier, décimal, date, booléen, énumération,
  obligatoire). Aucune règle par route à maintenir.
- `""` devient `null` hors colonnes texte : c'est ce que le formulaire envoie pour
  un champ vidé.
- Tests de non-régression qui rejouent la charge utile réelle des écrans
  (formulaire véhicule, démarrer puis terminer un OT).

**Pourquoi**
- Bug réel trouvé par le test : une date laissée vide faisait échouer en silence
  **toute** la modification du véhicule (200 renvoyé, rien d'enregistré).
- Une demande de pièce pouvait naître déjà « Sortie du stock » si le client envoyait le statut.
- Incidents : LESSONS_LEARNED « Modification de véhicule perdue en silence »,
  « Nettoyage des tests bloqué par les alertes ».

## d4f928c - PATCH pièce, pneu, panne, pneu monté (T3, T4)

**Quoi**
- PATCH pièce : champs d'audit du corps ignorés, 400 par champ, 404 pièce inconnue,
  409 référence en double, plus de texte d'erreur brut.
- PATCH pneu : `ZodError` -> 400 ; panne du catalogue et pneu monté : `prepareColumnUpdate`.

**Comment**
- Tests de contrat écrits d'abord : 6 rouges (500 partout), puis verts.
- Les deux erreurs métier connues du service pièce (message texte) sont traduites
  en `AppError` avec le bon statut ; tout le reste devient 500 générique journalisé.

**Pourquoi**
- La route renvoyait `error.message` au client, y compris une erreur SQL (interdit, AGENTS.md §10).
- Le client pouvait réécrire `createdBy` / `createdAt` d'une fiche pièce (traçabilité stock, AGENTS.md §5).
- Incident : LESSONS_LEARNED « PATCH pièce : texte d'erreur exposé et champs d'audit modifiables ».

## 676de75 - Règlement fournisseur idempotent (T7 paiement)

**Quoi**
- Un règlement de facture fournisseur soumis deux fois n'est enregistré qu'une fois.
- Le reste à régler déduit les règlements saisis et pas encore rapprochés.
- Un second rapprochement bancaire du même règlement répond 200 au lieu de 500.
- Les erreurs de ces routes passent par le contrat d'erreur (400/404/409 lisibles,
  plus de `details: error.message`).

**Comment**
- Test d'intégration écrit d'abord (`tests/integration/supplier-settlement-idempotence.test.ts`,
  7 cas) : 6 rouges. Il appelle le service directement, avec `Promise.all` pour
  simuler deux clics simultanés.
- Service (`server/services/three-way-matching-service.ts`) :
  - saisie dans une transaction, verrou `FOR UPDATE` sur la facture : deux saisies
    simultanées passent l'une après l'autre ;
  - clé d'idempotence métier = référence de paiement : même référence et même
    montant -> règlement existant rendu (`replayed: true`) ; autre montant -> 409 ;
  - rapprochement en compare-and-set (`where status = 'recorded'`), même motif que
    la sortie de stock (179015d) ;
  - erreurs métier levées en `AppError` au lieu de `Error` texte.
- Route (`server/api/supplier-invoices.routes.ts`) : rejeu -> 200 sans diffusion
  WebSocket (rien n'a changé), justificatif du rejeu supprimé du disque ; `catch`
  -> `next(error)`, le gestionnaire central journalise ; `console.error` migré vers
  `moduleLogger("supplier-invoices")`.
- Test de contrat (`tests/contract/supplier-settlement-idempotence.contract.test.ts`) :
  vrai envoi multipart avec justificatif, session secrétaire. Rejoué sans le correctif
  (`git stash` des deux fichiers) : 2 rouges sur 3, donc le test détecte bien le bug.
- Le client (`client/src/pages/procurement/invoices/[id].tsx`) dédoublonne déjà la
  liste par `id` : un 200 de rejeu ne crée pas de doublon à l'écran, rien à changer.

**Pourquoi**
- Risque financier direct : une facture pouvait être payée deux fois au fournisseur.
- Le solde ne baisse qu'au rapprochement bancaire, qui arrive des jours plus tard :
  le contrôle de plafond doit compter les règlements en attente, sinon il ne protège rien.
- Rejeu en 200 plutôt qu'en 409 : la personne qui a double-cliqué a bien fait ce
  qu'elle voulait, elle ne doit pas voir une erreur.
- Incident : LESSONS_LEARNED « Règlement fournisseur : facture payable deux fois ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 386/386 ; `npm run test:contract` 46/46 ;
  `npm run test:integration` 30/30.
- Sur 5 passages de l'intégration, 2 ont échoué sur `management-dashboard-service`
  avec `ETIMEDOUT` à la connexion Neon (réseau), sans lien avec ce changement ;
  le fichier passe seul et sur les autres passages.
- 0 ligne `TEST-` orpheline, 0 justificatif `TEST-` sur disque.

**Reste**
- Même contrôle à faire sur l'encaissement client : fait au commit suivant.

## (ce commit) - Encaissement client idempotent (T7 paiement, T3)

**Quoi**
- Un paiement de facture client saisi deux fois n'est enregistré et déduit qu'une fois.
- Deux paiements simultanés sont tous deux déduits (plus de paiement perdu).
- Paiement au-delà du solde ou sur facture annulée : 409 lisible.
- Corps invalide (montant non numérique, négatif, mode inconnu) : 400 lisible, solde intact.

**Comment**
- Test d'intégration d'abord (`tests/integration/client-payment-idempotence.test.ts`) : 8 rouges.
  Le cas des deux paiements partiels simultanés est vert seul et rouge dans la suite
  sur l'ancien code : c'est une vraie course, sa détection dépend du timing.
- Service (`server/services/client-billing-service.ts`, `recordPayment`) : même motif que
  676de75 : transaction, `FOR UPDATE` sur la facture, clé d'idempotence = référence
  de paiement, plafond vérifié sous verrou, `AppError` 404/409. `console.log` migrés vers
  `moduleLogger("client-billing")`.
- Route (`server/api/billing.routes.ts`) : schéma Zod avec messages en français, mode de
  paiement dérivé de l'énumération de la colonne (`clientPayments.paymentMethod.enumValues`),
  erreurs -> `next(error)`, pas de diffusion WebSocket sur un rejeu.
- Écran (`client/src/pages/operations/invoices/[id].tsx`) : toast d'erreur via
  `userMessageOf` au lieu de `error.message` (AGENTS.md §10). Le cache dédoublonnait déjà
  le paiement par `id`, et le bouton est désactivé pendant l'envoi.
- Test de contrat (`tests/contract/client-payment-idempotence.contract.test.ts`, 7 cas)
  rejoué sans le correctif (`git stash`) : 5 rouges.

**Pourquoi**
- Le lost update fausse la comptabilité sans erreur visible : paiement présent dans
  l'historique, solde non baissé, relance du client à tort.
- Un `NaN` dans `balance` casse la facture et tous les agrégats qui la lisent (tableau de bord).
- Pour un paiement sans référence (espèces), seule la protection de plafond s'applique :
  deux paiements identiques sans référence restent deux paiements, car rien ne permet
  de distinguer un rejeu d'un second versement réel. Choix volontaire, plutôt qu'une
  fenêtre de temps heuristique qui fusionnerait de vrais paiements.
- Changement de comportement assumé : un trop-perçu est maintenant refusé (409) au lieu
  de rendre le solde négatif, comme côté fournisseur.
- Incident : LESSONS_LEARNED « Encaissement client : paiement perdu, trop-perçu et solde NaN ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 386/386 ; `npm run test:integration` 38/38 ;
  `npm run test:contract` 53/53 ; 0 ligne `TEST-` orpheline.
- Plus aucune route de paiement sans protection : `billing.routes.ts` (encaissement),
  `supplier-invoices.routes.ts` (règlement, rapprochement, legacy `/payment`). T7 passe à « Fait ».
