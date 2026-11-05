# Portée des diffusions temps réel resserrée aux rôles de lecture (fournisseurs, pneus, chauffeurs)

- Les trames des fournisseurs sont limitées aux rôles de lecture des fournisseurs.
- Les trames des pneus sont limitées au personnel.
- Les trames des chauffeurs partent au personnel hors chauffeur et au chauffeur concerné (même modèle que les missions) ; `server/lib/driver-realtime.ts` porte ce calcul.
- Écrans satellites vérifiés (`client/src/lib/realtime-satellites.ts`) : aucun n'est piloté par ces événements.
- Garde : `tests/contract/staff-realtime-scope.contract.test.ts` (résolveur réel, mutation vue rouge) ; quatre entrées retirées de la liste gelée de `broadcast-hygiene`.
