## V3 point 3 : déclaration de panne activée par défaut

**Quoi** : le drapeau `incidents` passe à actif par défaut. Un seul point d'entrée chauffeur : `/driver/incident` redirige vers `/driver` (le tableau de bord, qui envoie à `/api/driver/breakdowns`), sans nouvelle entrée de menu. La liste des pannes affiche l'immatriculation au lieu de l'identifiant du véhicule. La phrase « avec création de l'ordre de travail » est retirée de la description de l'écran. L'alerte temps réel d'une panne atteint aussi la logistique.

**Comment** : `vehicleRegistration` ajouté au contrat `incidentSchema` (jointure `vehicles` en lecture, lecture du véhicule après création) ; portée du broadcast `incident_reported` prise dans `REALTIME_EVENTS` (atelier + logistique, une seule définition) ; écran de déclaration remplacé par une redirection ; activation par la valeur par défaut de `shared/feature-flags.ts`.

**Pourquoi** : recette V3 faite ; la logistique lit déjà les avis de maintenance de mission et doit être prévenue au même moment que l'atelier ; l'écran ne doit rien promettre qu'il ne fait pas. La colonne « OT » de la liste reste : l'OT est réellement ouvert par la route chauffeur pour une panne ou un accident.

**Preuve** : tests unitaires `incident-screens` (immatriculation, redirection, pas de promesse d'OT, portée) et `incident-service` ; contrat `incidents` (immatriculation en création et en lecture, route fermée avec `incidents=off`) ; gardes de dette `broadcast-hygiene` et `default-paginated-reads-hygiene` mises à jour ; tsc et `npm run check:tests` : 0 erreur.

## Rôles de POST /api/incidents (revue sécurité)

- Quoi : la déclaration est réservée au chauffeur et à l admin (avant : tout le personnel).
- Pourquoi : comptable, RH ou magasin n ont pas l écran et déclencheraient l alerte atelier.
- Preuve : contrat incidents (admin 201 ; chef d atelier et comptable 403).
- Dette connue : GET /api/incidents reste ouvert à tout le personnel (OPEN_GET_READS_FROZEN).
