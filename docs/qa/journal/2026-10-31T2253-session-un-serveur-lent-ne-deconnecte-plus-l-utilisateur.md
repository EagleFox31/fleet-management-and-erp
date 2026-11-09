## 163a20a - Session : un serveur lent ne déconnecte plus l'utilisateur

**Quoi**
- Au démarrage, seul un 401 de `/api/auth/me` vaut « pas de session ». Un délai dépassé, une coupure
  réseau ou une 5xx gardent l'utilisateur en attente : nouvelle tentative automatique et panneau
  « Le serveur met du temps à répondre » avec un bouton « Réessayer maintenant ».
- e2e `01-auth-login` : nouveau cas « serveur lent ». Unitaire `session-check`.

**Comment**
- `client/src/lib/session-check.ts` : `checkSession` renvoie `authenticated` / `anonymous` /
  `unreachable` (délai 10 s) ; `nextSessionRetryDelay` donne 1, 2, 4, 8 puis 10 s.
- `useAuth` : boucle de tentatives à la place du chien de garde de 12 s qui forçait `user = null`.
  `isLoading` reste vrai tant que le serveur ne répond pas, donc les routes protégées ne redirigent pas.
  Connexion et déconnexion interrompent la boucle. `mountedRef` est remis à vrai au montage (double
  montage du mode strict).
- L'e2e bloque le service worker PWA (`serviceWorkers: "block"`), sinon `page.route` ne voit pas les
  requêtes.

**Pourquoi**
- Le serveur de dev met jusqu'à ~35 s à servir une page. Le contrôle abandonnait à 8 s et renvoyait
  vers la connexion un utilisateur dont la session était valide (constat de caed509).

**Preuve**
- e2e `01-auth-login` 3/3. Le cas « serveur lent » échoue sur l'ancien `useAuth`.
- Unitaire 789/789 ; `npm run check` 0 erreur.
- Lancement e2e sur `E2E_BASE_URL=http://127.0.0.1:5055` : le port 5000 était occupé par une autre
  application, que Playwright réutilisait (`reuseExistingServer`).

