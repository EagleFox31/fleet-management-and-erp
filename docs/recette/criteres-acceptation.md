# Critères d'acceptation figés, recette du 2 novembre 2026

Source : `../lot-tools/plan/01-product.md` (plan produit) et ADR 0001 (écarts). Format : Given / When / Then,
chaque critère se vérifie à l'écran ou par un code HTTP. Un MUST est livré lundi ; un SHOULD est
derrière un drapeau (`shared/feature-flags.ts`) tant qu'il n'est pas validé en répétition générale.
P-12 n'existe pas au plan (numérotation sautée). P-23 (e-mail) est coupé : voir la fin du document.

Défauts en attente du client : D-03 finance/QHSE masqués, D-06 verrou 5 échecs / 15 min,
D-13 notifications in-app seulement, D-19 données fictives uniquement.

## MUST

| ID | Critère (Given / When / Then) | Drapeau |
|---|---|---|
| P-01 | Given un compte client ou chauffeur, When il appelle un des 8 exports, Then réponse 403 (client : l'export filtré sur ses lignes vient au lot suivant). Given logistics ou admin, When il exporte, Then il reçoit le fichier. | `exports` (coupe-circuit) |
| P-02 | Given un admin, When il ajoute le type « Jaugeage, 24 mois », Then il apparaît dans la liste des 9 types. Given un camion avec un document de ce type, When l'échéance est à 30 jours ou moins, Then l'alerte s'affiche, pour chacun des types ayant une durée. ACF et agrément PD : pas de durée tant que le client n'a pas répondu (Q-01). | aucun |
| P-03 | Given un compte actif, When 5 mots de passe faux se suivent, Then la 6e tentative est refusée avec un message lisible et l'heure de fin du verrou. Given un admin, When il déverrouille, Then la connexion refonctionne. Seuils : D-06. | aucun |
| P-04 | Given un admin qui modifie un OT, When il ouvre le journal d'audit, Then une ligne indique auteur, date, objet, action ; filtrable par utilisateur et par date. Given un chef d'atelier, When il appelle le journal, Then 403. | aucun |
| P-05 | Given un admin, When il ouvre « Sauvegardes », Then il voit la dernière sauvegarde (moins de 24 h), sa taille et la rétention de 12 mois. Given un échec simulé, When la sauvegarde échoue, Then une alerte est visible. Aucune promesse « zéro perte » (D-04). | aucun |
| P-06 | Given un OT, When le chef d'atelier clique « Exporter en Word », Then il obtient un .docx avec en-tête TAY, véhicule, lignes, pièces, signatures. Given une pièce sortie, When le magasinier exporte, Then il obtient le bon de sortie. | `exports` |
| P-07 | Given un utilisateur, When il désactive « document expirant » dans ses préférences, Then il ne reçoit plus cette alerte et les autres utilisateurs la reçoivent encore. Canal : in-app (D-13). | aucun |
| P-08 | Given un technicien déjà affecté à un OT en cours sur un créneau, When le chef d'atelier l'affecte à un second OT sur le même créneau, Then refus avec message clair et aucune écriture. Idem pour deux OT ouverts sur un même véhicule. | aucun |
| P-09 | Given la direction, When elle ouvre le tableau de bord, Then 3 tuiles : incidents par mois, conformité préventive, coût moyen par intervention ; un recomptage manuel sur un mois donne les mêmes chiffres que la liste des OT. | aucun |
| P-10 | Given tout profil, When il parcourt les menus, Then aucun accès à finance, QHSE, GPS, tarifs. Given la page « Périmètre et prochains lots », When elle s'ouvre, Then elle liste ce qui est livré, en essai et à venir. Les drapeaux se règlent par configuration. | `finance`, `qhse`, `gps`, `pricing` coupés |
| P-11 | Given l'environnement de recette, When un testeur se connecte avec le compte de son profil, Then il voit des véhicules, OT, pièces, missions et factures fictifs. Given une remise à zéro, When elle est lancée, Then le même état revient en moins de 5 minutes. Aucun mot de passe `admin123` (D-19). | aucun |

## SHOULD (derrière drapeau, activés seulement si validés en répétition)

| ID | Critère (Given / When / Then) | Drapeau |
|---|---|---|
| P-13 | Given un OT, When le chef d'atelier ouvre l'onglet Historique, Then chaque changement de statut apparaît avec auteur et heure. | `work-order-audit-trail` |
| P-14 | Given un véhicule, When logistics l'ouvre, Then le total maintenance et pièces égale la somme des OT clôturés. | `vehicle-cost-summary` |
| P-15 | Given le magasinier, When il ouvre le journal des pneus, Then il voit entrées et sorties avec date, immatriculation, position, km parcourus. | `tire-movements` |
| P-16 | Given une demande commandée, When le magasinier la réceptionne, Then elle affiche « Entrée en stock par X, le … ». Given un chef d'atelier, Then il ne peut pas réceptionner. Pas de route dédiée : la transition existante porte `receivedBy` (ADR, écarts). | `part-requirement-receive` |
| P-17 | Given un bon d'essence, When un rôle autorisé le valide, Then statut « validé » avec l'auteur. Given un technicien, Then 403. Rôles : D-07. | `fuel-vouchers` |
| P-18 | Given une anomalie carburant, When logistics la marque « traitée » avec un commentaire, Then elle quitte la liste active. | `fuel-anomalies` |
| P-19 | Given un prix de 843 FCFA daté du 1er novembre, When un plein est saisi le 2 novembre, Then 843 est utilisé. Given un plein du 30 octobre, Then 828 est conservé. | `fuel-prices` |
| P-20 | Given une secrétaire, When elle saisit un mois pour 3 chauffeurs, Then le total par code (JT, M, Mi, C, A, R, Re) s'affiche ; le chauffeur voit le sien en lecture seule. | `time-tracking` |
| P-21 | Given des factures impayées, When la secrétaire ouvre la liste, Then elles sont triées par âge avec le nombre de jours exact. | `pending-invoices` |
| P-22 | Given un chauffeur, When il déclare une panne sur son véhicule, Then le chef d'atelier reçoit une alerte en temps réel (trame WebSocket) et peut créer l'OT. | `incidents` |
| P-24 | Given la création d'un plan « vidange moteur », When le km actuel est saisi, Then l'échéance proposée est km actuel + 10 000 (boîte, pont, satellite : + 50 000), modifiable. | `oil-change-prefill` |
| P-25 | Given un OT terminé, When le chef d'atelier le rejette avec un motif, Then il repasse en cours ; s'il le valide, il reste terminé. | `quality-check` |
| P-26 | Retiré le 1er novembre 2026 : pas de captcha à la connexion. Le verrouillage P-03 reste la protection contre les essais répétés. | — |

## Coupé du lot

| ID | Décision | Conséquence |
|---|---|---|
| P-23 | E-mail coupé (ADR 0001, écarts). | Le champ `email` des préférences existe mais n'est ni affiché ni honoré (`email-notifications` coupé). Aucun envoi lundi. |

## Règle de sortie de la recette

Zéro bloquant ouvert ; au moins 12 scénarios sur 14 conformes (les scénarios dépendant d'un SHOULD non
livré sont sautés, pas comptés en échec) ; chaque réserve a un propriétaire et une date.
