# Matrice Rôles - Factures Fournisseur

## Règle métier cible (appliquée)

| Use case facture fournisseur | Admin | Secrétaire | Magasinier | Logistique/Achats | Chef d'atelier | Technicien |
|---|---|---|---|---|---|---|
| Consulter (liste, détail, stats, écarts, retard) | Oui | Oui | Oui | Oui | Oui | Non |
| Créer / Saisir facture | Oui (backup) | Oui (principal) | Non | Non | Non | Non |
| Import Excel facture | Oui (backup) | Oui (principal) | Non | Non | Non | Non |
| Valider facture liée pièces atelier | Oui (backup) | Non | Oui | Non | Oui | Non |
| Valider facture hors atelier | Oui (backup) | Oui | Non | Oui | Non | Non |
| Valider facture sans BC lié (administratif) | Oui (backup) | Oui | Non | Non | Non | Non |
| Approuver facture | Oui (backup) | Oui (principal) | Non | Non | Non | Non |
| Enregistrer paiement | Oui (backup) | Oui (principal) | Non | Non | Non | Non |
| Auto-approve | Oui (supervision automation) | Non | Non | Non | Non | Non |

## Traduction API

- Lecture: `GET /api/supplier-invoices*` -> `admin | secretary | warehouse | logistics | workshop_manager`
- Création: `POST /api/supplier-invoices` -> `admin | secretary`
- Import: `POST /api/supplier-invoices/import` -> `admin | secretary`
- Validation:
  - scope `parts` -> `admin | warehouse | workshop_manager`
  - scope `non_parts` -> `admin | secretary | logistics`
  - scope `none` -> `admin | secretary`
- Approbation: `PATCH /api/supplier-invoices/:id/approve` -> `admin | secretary`
- Paiement: `POST /api/supplier-invoices/:id/payment` -> `admin | secretary`
- Auto-approve: `POST /api/supplier-invoices/auto-approve` -> `admin` (réservé moteur)

## Note de séparation des tâches

- Demandeur != validateur
- Réceptionnaire != payeur
- Approbation et paiement restent sur les profils administratifs
