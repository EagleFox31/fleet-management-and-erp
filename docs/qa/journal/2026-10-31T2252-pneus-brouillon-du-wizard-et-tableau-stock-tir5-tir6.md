## caed509 - Pneus : brouillon du wizard et tableau stock (TIR5, TIR6) ; nettoyage de test cloisonné

**Quoi**
- Brouillon de formulaire : l'auto-enregistrement pendant la saisie ne s'exécutait jamais. Le brouillon
  n'était écrit qu'au changement d'étape. Corrigé dans `useFormDraft`, ce qui vaut pour ses 14 formulaires.
- Wizard pneu : `useSingleFlightMutate` sur la création (AGENTS.md §10) et message d'erreur par
  `userMessageOf` au lieu de `error.message`.
- Nettoyage des tests : `cleanupOrphanTestRows` ne supprime plus que les lignes `TEST-` vieilles de plus
  de 2 h. Il effaçait, à la fin de chaque fichier, les utilisateurs et données des lancements concurrents.
- e2e `12-tire-wizard-draft-and-table` : TIR5 et TIR6.

**Comment**
- `persistDraft` dépendait de `getMeta` / `isEmpty`, souvent passés en fonctions inline, donc recréés à
  chaque rendu. L'effet `form.watch` se réabonnait à chaque frappe et son nettoyage annulait le minuteur
  en attente. Le watch appelle maintenant `persistDraft` par une ref et ne dépend plus que de
  `debounceMs`, `enabled` et `form`.
- `cleanupOrphanTestRows` : filtre `created_at < now() - 2 hours` ajouté au filtre de préfixe, sur
  chaque table balayée.

**Pourquoi**
- La base de test est partagée (`DATABASE_URL_TEST` = `DATABASE_URL`) par cette session, les e2e et les
  worktrees du lot. Le balayage global expliquait les 401 en série des suites contrat et les échecs
  intermittents de `client-payment-idempotence` (utilisateur ou lignes supprimés en plein test).

**Preuve**
- e2e 12 rouge sur l'ancien hook (brouillon jamais écrit pendant la saisie), vert après : 2/2.
- La garde double clic n'est pas prouvée par l'e2e : sans elle, le double clic n'envoyait déjà qu'une
  requête. Conservée par règle (§10).
- Unitaire 781/781 ; `npm run check` 0 erreur ; contrat 398/398 (37 fichiers, plus aucun 401) ;
  intégration 89/90 : seul échec `login-lockout-db-store`, table `login_attempts_by_username` absente
  (migration du lot T-12 non appliquée), sans lien.
- Constat hors périmètre : `getCurrentUser` (`client/src/lib/auth.ts`) abandonne `/api/auth/me` après
  8 s et renvoie alors vers la connexion. Un serveur lent passe pour une déconnexion.

