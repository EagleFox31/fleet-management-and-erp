# Matrice des scénarios de recette R-01 à R-14 vers les fonctionnalités P-xx

(S) : le scénario dépend d'un SHOULD derrière drapeau ; s'il n'est pas livré, l'étape saute sans bloquer.
Chaque scénario : un testeur, un compte fictif, 5 à 9 étapes, case conforme / réserve / bloquant.

| Scénario | Profil | Parcours | Résultat attendu | Fonctionnalités | Drapeau requis |
|---|---|---|---|---|---|
| R-01 | Admin | Connexion, création d'un utilisateur, 5 faux mots de passe, déverrouillage | Verrou à la 6e tentative, accès rétabli | P-03 | |
| R-02 | Admin | Modifier un OT et un stock, ouvrir le journal d'audit et l'état des sauvegardes | Lignes d'audit exactes, sauvegarde de moins de 24 h | P-04, P-05 | |
| R-03 | Client | Voir ses véhicules, tenter l'export de toutes les factures | 403 sur l'export, ses véhicules seulement | P-01 | |
| R-04 | Logistics | Acquérir un véhicule, joindre les documents dont le jaugeage, constater l'alerte | Véhicule activé, alerte à 30 jours | P-02 | |
| R-05 | Chef d'atelier | Créer un OT, affecter un technicien, tenter une seconde affectation sur le même créneau | Refus clair, aucune écriture | P-08 | |
| R-06 | Technicien et chef d'atelier | Le technicien démarre l'OT, le chef voit le changement sans rafraîchir (trame WebSocket vérifiée) | Mise à jour en moins de 2 s | existant | |
| R-07 | Chef d'atelier puis magasinier | Demande de pièce, approbation, commande, entrée en stock, sortie, clôture, export Word | En attente, Approuvée, Commandée, Entrée en stock, Sortie du stock ; Word correct | P-06, P-16 (S) | `part-requirement-receive` |
| R-08 | Magasinier | Ajuster un stock, alerte de stock bas, monter un pneu, journal des pneus | Alerte au seuil `<=` ; mouvement tracé (S) | existant, P-15 (S) | `tire-movements` |
| R-09 | Secrétaire | Bon de commande, réception, facture fournisseur, rapprochement à 3 voies, paiement | Écart de 5 % détecté, paiement idempotent, trop-perçu refusé | existant | |
| R-10 | Logistics ou secrétaire carburant | Recharger la carte, saisir un plein, traiter une anomalie, valider un bon | Solde en litres exact ; anomalie et bon traités (S) | existant, P-17 (S), P-18 (S) | `fuel-vouchers`, `fuel-anomalies` |
| R-11 | Logistics | Mission, contrôle du lancement, facture, paiement partiel puis total | Statuts de facture cohérents ; âge des créances (S) | existant, P-21 (S) | `pending-invoices` |
| R-12 | Direction | Tableau de bord, 3 KPI, carte des corridors | KPI recomptables ; aucun menu finance ou QHSE | P-09, P-10 | |
| R-13 | Chauffeur | Ses missions et son CPC, déclaration de panne reçue par le chef d'atelier | Alerte temps réel (S) ; pointage en lecture (S) | existant, P-22 (S), P-20 (S) | `incidents`, `time-tracking` |
| R-14 | Tout profil | Régler ses notifications, provoquer une alerte de document expirant | Alerte reçue ou non selon la préférence, in-app seulement | P-07 | |

## Couverture inverse (P-xx vers scénarios)

| P-xx | Scénarios |
|---|---|
| P-01 | R-03 |
| P-02 | R-04 |
| P-03 | R-01 |
| P-04, P-05 | R-02 |
| P-06 | R-07 |
| P-07 | R-14 |
| P-08 | R-05 |
| P-09, P-10 | R-12 |
| P-11 | tous (environnement) |
| P-15 | R-08 |
| P-16 | R-07 |
| P-17, P-18 | R-10 |
| P-20, P-22 | R-13 |
| P-21 | R-11 |
| P-13, P-14, P-19, P-24, P-25, P-26 | aucun scénario dédié : test libre si le drapeau est activé |

Écarts : le plan d'origine citait P-23 (e-mail) pour R-14 ; il est coupé du lot.
