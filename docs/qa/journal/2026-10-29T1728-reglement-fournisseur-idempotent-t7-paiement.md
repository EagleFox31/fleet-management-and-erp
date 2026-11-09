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

