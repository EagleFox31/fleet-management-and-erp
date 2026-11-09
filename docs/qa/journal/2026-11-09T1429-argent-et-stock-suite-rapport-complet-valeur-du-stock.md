## 2026-11-09T14:29:18+01:00 — Argent et stock, suite : rapport complet, valeur du stock, alertes de réappro, historique

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - rapport PDF des coûts de maintenance : `GET /api/work-orders` était appelé sans `limit` (50 par défaut), le rapport ne comptait que les 50 premiers OT. `fetchAllWorkOrders` lit par pages de 500 jusqu'au total ; échec, forme invalide, liste incomplète ou plus de 20 pages → rapport refusé avec un message clair ;
  - même rapport : véhicules ou utilisateurs illisibles → refus ; lecture de `/api/parts/used` retirée (elle ne nourrissait aucun calcul) ;
  - `useWarehouse` : plus d'alertes de réappro calculées sur le stock bas seul quand les demandes de pièce sont illisibles ; `inventoryValue` et `reorderAlerts` exposent `view` / `failed` ;
  - tableaux de bord admin, accueil, chef d'atelier, magasin, panneau d'alertes : « Indisponible » et encart au lieu de 0, « Aucune alerte » ou « Tout est à jour » ;
  - catalogue pièces (statut des demandes), fiche pièce (historique de stock), fiche OT (demandes en attente, compte de l'onglet Pièces) : encart au lieu d'un vide.
- **Comment tester (QA)** :
  - `tests/unit/client/fetch-all-work-orders.test.ts` : 8 cas sur fetch simulé (120 OT sur 3 pages, échec en page 2, page vide avant le total, forme invalide, borne de 20 pages) ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : 33 cas, chaque ajout rouge sur le code d'avant puis vert ;
  - campagnes : tsc 0, check:tests 0, unitaires 319 fichiers / 3325 tests. Aucun fichier serveur modifié.
- **RAIDER** :
  - R : `queryView`, `listQueryView`, `InlineQueryError`, `UNAVAILABLE` existants ; `fetchAllWorkOrders` réutilisable par les autres rapports ;
  - D : réponses API inchangées ; pour moins de 500 OT, le rapport fait un seul appel comme avant ;
  - dérogation : le `console.log` des pièces utilisées part avec le fetch inutile qu'il décrivait (accord de l'orchestrateur, écrit dans la PR).

  Ne s'appliquent pas : A, I, Retroactive (aucune donnée ni schéma touchés).
- **Reste / risques** : solde de carte carburant (`|| 0`) sur les tableaux de bord admin et accueil ; `/api/alerts` du panneau d'alertes sans état d'erreur ; véhicules du rapport lus avec `limit=1000`. Revue sécurité requise (argent/stock).

