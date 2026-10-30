# Questions à valider avec TAY avant et après la recette du 2 novembre

Document pour le client : langage métier. Pour chaque question, nous avons appliqué une valeur
provisoire pour que la recette puisse avoir lieu. Si vous ne répondez pas, cette valeur reste.
Vous pouvez la changer sans attendre une nouvelle livraison : tout est réglable.

Note de rédaction (à retirer avant envoi) : la demande évoquait 13 questions ouvertes ; le plan produit
en contient 19 (D-01 à D-19). Elles sont toutes reprises ci-dessous, plus la durée de validité de l'ACF et
de l'agrément PD (ADR 0001, écarts au plan). Le numéro du plan est indiqué entre parenthèses.

## Priorité haute : à confirmer avant lundi

| N° | Question | Valeur provisoire si pas de réponse | Qui répond |
|---|---|---|---|
| Q-01 | Pendant combien de mois l'ACF et l'agrément PD d'un véhicule sont-ils valables ? | Aucune durée : le document est enregistré mais aucune alerte d'échéance n'est calculée tant qu'une durée n'est pas saisie | Logisticien |
| Q-02 | Quelle est la validité du TAE et de la vignette ? (nous avons repris vos fichiers ; une autre source parlait de 5 ans pour le TAE) (D-16) | TAE 6 mois, vignette 1 an | Logisticien |
| Q-03 | Voulez-vous voir la finance, la QHSE, le pointage et la facturation hors cahier des charges dès lundi ? (D-03) | Non : ces parties sont annoncées pour un lot suivant et masquées | Direction et chef de projet |
| Q-04 | Combien d'échecs de connexion avant blocage d'un compte, et pour combien de temps ? (D-06) | 5 échecs de suite, blocage de 15 minutes, déblocage possible par l'administrateur | Responsable sécurité |
| Q-05 | Une sauvegarde quotidienne ne garantit pas zéro perte de données. Souhaitez-vous demander à l'hébergeur une restauration à un instant précis ? (D-04) | Sauvegarde quotidienne chiffrée, conservée 12 mois, alerte en cas d'échec ; nous ne promettons pas « zéro perte » | Direction et responsable de l'hébergement |

## Finance et exploitation (lot suivant)

| N° | Question | Valeur provisoire | Qui répond |
|---|---|---|---|
| Q-06 | Les retenues TVA 19,25 % et IS 2,2 % se calculent-elles sur le montant hors taxes ou toutes taxes comprises ? (D-01) | Hors taxes | Comptable |
| Q-07 | Quelle formule pour la rentabilité d'une opération ? (D-02) | Formule du fichier EDBT : net moins frais BGFT/BARC, frais de mission et prime, consommation, charges fixes | Direction |
| Q-08 | Quel fournisseur pour la connexion unique (Microsoft, Google, autre) ? (D-05) | Aucun : mot de passe et blocage de compte | Responsable informatique |
| Q-09 | Quel serveur d'envoi d'e-mails utiliser pour les alertes ? Et souhaitez-vous des SMS ? (D-13) | Alertes dans l'application seulement ; ni e-mail ni SMS | Responsable informatique |
| Q-16 | Quels seuils pour les alertes d'écart de consommation, de « reste kilomètres » et de montant à faire valider par le directeur ? (D-14) | Aucune alerte automatique tant qu'un administrateur n'a pas saisi de seuil ; nous n'inventons pas de valeur | Direction |
| Q-17 | Quel est le prix du litre de gasoil à retenir ? (D-15) | 828 FCFA jusqu'à la saisie d'un premier prix daté | Logisticien |

## Rôles et règles d'atelier et de magasin

| N° | Question | Valeur provisoire | Qui répond |
|---|---|---|---|
| Q-10 | Qui valide les bons de carburant et saisit les pleins ? Il n'existe pas de rôle « secrétaire de gasoil ». (D-07) | Les rôles secrétaire et logistique | Direction |
| Q-11 | Qui peut réceptionner les pièces ? (D-08) | Magasinier et administrateur ; ni la logistique ni la secrétaire | Chef d'atelier et magasinier |
| Q-12 | Une pièce est en stock bas quand la quantité est strictement inférieure au seuil, ou inférieure ou égale ? (D-09) | Inférieure ou égale (colonne SITUATION de votre fichier) | Magasinier |
| Q-13 | La date d'une intervention est-elle celle de la panne ou celle de la fin des travaux ? (D-10) | Date de la panne ; la date de fin reste un champ à part | Chef d'atelier |
| Q-14 | Faut-il une étape « annulation demandée » dans la chaîne des demandes de pièce ? (D-11) | Non : En attente, Approuvée, Commandée, Entrée en stock, Sortie du stock | Chef d'atelier |
| Q-15 | Le modèle de document Word convient-il : en-tête TAY repris de votre PDF, ordre de travail et bon de sortie seulement ? (D-12) | Gabarit simple avec cet en-tête, remplaçable | Chef d'atelier |
| Q-18 | Un ordre de travail clôturé peut-il revenir en attente ? (D-17) | Non | Chef d'atelier |
| Q-19 | Qui voit le menu Chauffeurs ? (D-18) | Logistique et administrateur | Direction |
| Q-20 | Les données de la recette sont-elles bien fictives, sans vos 12 fournisseurs réels ? (D-19) | Oui, uniquement des données fictives | Direction |

## Ce que nous ne demandons pas encore

SMS, mobile, suivi GPS, QHSE, tarifs et trésorerie : nous les traiterons après vos réponses ci-dessus.
Voir la page « Périmètre et prochains lots » dans l'application.
