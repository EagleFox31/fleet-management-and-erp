# Chantier — Cartographie Interactive des Corridors CEMAC (Espace Direction & Logistique)

> Visualisation macro et temps réel de la flotte en transit sur les corridors stratégiques d'Afrique Centrale (Cameroun, Tchad, RCA).

Dernière mise à jour : 29 août 2026

---

## 1. Objectifs Métier

1. **Vue Macro Exécutive (Directeur Général)** :
   * Donner au DG une vision spatiale immédiate en 10 secondes : *Combien de camions roulent actuellement ? Sur quels corridors ? Quels sont les camions à l'arrêt ou en alerte ?*
2. **Suivi des Corridors Stratégiques CEMAC** :
   * **Corridor Nord (N1/N3)** : Douala $\rightarrow$ Yaoundé $\rightarrow$ Ngaoundéré $\rightarrow$ Garoua $\rightarrow$ Maroua $\rightarrow$ N'Djamena (Tchad).
   * **Corridor Ouest (N3/N4/N6)** : Douala $\rightarrow$ Bafoussam $\rightarrow$ Bamenda.
   * **Corridor Est / RCA (N10)** : Yaoundé $\rightarrow$ Bertoua $\rightarrow$ Batouri $\rightarrow$ Garoua-Boulaï $\rightarrow$ Bangui (RCA).
   * **Corridor Sud / Portuaire (N7/N2)** : Douala $\rightarrow$ Kribi $\rightarrow$ Ebolowa $\rightarrow$ Ambam $\rightarrow$ Guinée Équatoriale / Gabon.
3. **Statuts des Véhicules en Temps Réel** :
   * 🟢 **En transit (Fret)** : Camion en mission active de livraison.
   * 🔵 **En retour** : Camion en rotation retour vers base/dépôt.
   * 🟡 **À l'arrêt / Chez le client** : Déchargement ou pause réglementaire.
   * 🔴 **En alerte / Incident** : Immobilisation imprévue ou anomalie déclarée.

---

## 2. Choix Technologiques & Design

* **Moteur Cartographique** : **Leaflet** / **React-Leaflet** (ultra-léger, 0 dépendance lourde, 100% open-source, 0 coût de licence).
* **Fond de Carte** : **CartoDB Dark Matter** (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`) — thème sombre assorti au design glassmorphic de Yaro FleetOS avec routes éclairées en émeraude.
* **Corridors & Villes** : Référentiel de coordonnées GPS précises pour les 15 hubs logistiques clés du Cameroun et de la sous-région.
* **Popups Synthétiques** :
  * N° Immatriculation & Modèle de camion
  * Nom du chauffeur & Client assigné
  * Ville de départ $\rightarrow$ Destination
  * Type de fret (cargo) & Tonnage
  * Consommation moyenne carburant (L/100 km) & Vitesse estimée

---

## 3. Architecture Technique

```
shared/
  constants/
    cemac-corridors.ts            # Hubs GPS, géométrie des corridors, helpers de projection

server/
  services/
    management-dashboard-service.ts  # Agrégation des positions live flotte et missions actives

client/
  src/
    components/
      management/
        executive-corridor-map.tsx   # Composant React-Leaflet interactif avec dark tiles
        corridor-map-legend.tsx      # Légende des statuts et filtres rapides
    pages/
      management/
        dashboard.tsx                # Intégration du composant dans la vue Direction
```

---

## 4. Plan de Réalisation par Étapes

### Étape 1 — Référentiel & Constantes partagées
- [ ] Créer `shared/constants/cemac-corridors.ts` :
  - Coordonnées GPS des villes (Douala, Yaoundé, Bafoussam, Ngaoundéré, Garoua, Maroua, N'Djamena, Bertoua, Kribi, etc.).
  - Tracés vectoriels des 4 grands corridors.
  - Fonction de projection de la position d'un camion sur son axe selon son statut et son avancement.

### Étape 2 — Backend & Résolution des positions
- [ ] Mettre à jour `server/services/management-dashboard-service.ts` :
  - Récupérer les missions en cours (`in_progress`, `assigned`, `planned`) avec jointure véhicule, chauffeur, client.
  - Calculer la coordonnée GPS estimée ou réelle pour chaque véhicule.
  - Retourner `corridorFleet: LiveCorridorVehicle[]` dans la réponse `/api/management/dashboard`.

### Étape 3 — Frontend : Composant Cartographique Exécutif
- [ ] Installer `leaflet` et `@types/leaflet`.
- [ ] Créer `client/src/components/management/executive-corridor-map.tsx` :
  - Rendu de la carte avec tuiles CartoDB Dark Matter.
  - Polylines néon émeraude pour les corridors.
  - Marqueurs camions pulsants (icônes Lucide customisées en SVG).
  - Popups riches au clic / survol.
  - Filtres interactifs (Tous, En mission, Alertes, Par corridor).

### Étape 4 — Intégration dans le Dashboard Direction
- [ ] Intégrer la carte dans `client/src/pages/management/dashboard.tsx`.
- [ ] Ajouter une option de plein écran / agrandissement du panneau.

### Étape 5 — Tests & Validation
- [ ] Tests unitaires sur les constantes géographiques et la projection des coordonnées (`tests/unit/shared/cemac-corridors.test.ts`).
- [ ] Validation `npm test` et non-régression sur l'ensemble de l'application.
