## Rôle comptable (accountant)

**Quoi** : nouveau rôle `accountant` (Comptable) : valeur d'enum, groupes de rôles finance, gardes API, tableau de bord, menu, carte sur la landing, tests unitaires et de contrat.

**Comment** : valeur ajoutée à `users.role` ; `AppRole`, `ROLE_LABELS` et `STAFF_ROLES` s'en déduisent. Le comptable entre dans les groupes finance de `shared/constants/roles.ts` (factures fournisseur, facturation client, trésorerie, budgets de mission en lecture et décaissement, carburant en lecture) ; les gardes serveur et les écrans lisent ces mêmes groupes. Ajout seul : le secrétariat garde tous ses droits.

**Pourquoi** : séparer la tenue des comptes de l'exploitation. Le comptable ne crée ni ordre de travail, ni mission, ni commande, ni véhicule, ni recharge de la carte carburant.

**Preuve** : `npm run check` et `check:tests` à 0 erreur ; tests unitaires `accountant-role` ; contrat `accountant-role-guards` (403 sur sept écritures opérationnelles, 200 sur les lectures finance) ; contrat `billing-revenue-by-client` mis à jour.

**Non appliqué (options)** : séparation stricte des tâches (retirer le règlement au secrétariat) ; recharge de la carte carburant par le comptable. Aucun compte comptable dans le seed. Aucune vidéo de démo.
