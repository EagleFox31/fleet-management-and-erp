# Import des données TAY (`scripts/import-tay.ts`)

Charge les classeurs Excel du client TAY (véhicules, kilométrage, chauffeurs, fournisseurs)
dans la base. La logique pure (lecture, normalisation, diff) vit dans `scripts/lib/tay-import.ts`,
couverte par `tests/unit/scripts/tay-import.test.ts`. Les classeurs restent dans `attached_assets/`.
Aucun classeur, aucune donnée personnelle n'est versionnée par ce script.

## Usage

```bash
# Aperçu (par défaut) : comptes à insérer / mettre à jour / inchangés + anomalies, sans écriture
DATABASE_URL=... npx tsx scripts/import-tay.ts [--dir attached_assets] [--no-test-vehicle]
# Écriture, en une seule transaction
DATABASE_URL=... npx tsx scripts/import-tay.ts --apply

# Bundle autonome (node_modules doit être accessible depuis son dossier)
npx esbuild scripts/import-tay.ts --bundle --platform=node --packages=external --format=esm --outfile=import-tay.mjs
node import-tay.mjs --apply
```

Sans `DATABASE_URL`, l'aperçu se limite à la lecture des classeurs ; `--apply` échoue.
Le fichier retenu pour chaque classeur est celui au suffixe numérique le plus récent.

## Sources et correspondances

| Classeur | Feuille / en-tête | Cible |
|---|---|---|
| SUIVI DOCUMENTATION CAMIONS | 1re feuille, ligne « VEHICULES » | `vehicles` : plaque, type (TR → `tracteur`, SR → `semi_remorque`), `license_plate_expiry` (carte grise), `technical_inspection_date` (visite technique, échéance), `insurance_expiry` (assurance) |
| SUIVI DES CAMION TAY | « SUIVI 2025 », ligne 3 | `vehicles` : kilométrage max par plaque → `mileage`, `last_mileage`, `current_kilometers` ; lieu de ce relevé → `location_code` (NDERE / NDRE → NGAOUNDERE) |
| CPC ET HABILITATION | « CPC », ligne 2 | `drivers` : nom, prénom, permis et dates présentes |
| GESTION FOURNISSEURS | récap général (TOTAL exclu) + feuille FAMILLE | `suppliers` : nom, catégorie (Pièces, Assurance, Carburant, Télécom, Autre) |

Les dates sont importées telles quelles, même échues (décision utilisateur) : aucune n'est décalée.
Aucune ligne `vehicle_documents` n'est créée ; les alertes lisent déjà les trois colonnes d'échéance.

## Clés naturelles et champs possédés

- **Véhicule** : plaque normalisée `upper(regexp_replace(rn,'[^A-Za-z0-9]','','g'))`, même expression
  que l'index unique `vehicles_registration_key_idx`. Une fiche existante garde sa graphie.
  En mise à jour, seuls les trois échéances (source non nulle), le kilométrage (`GREATEST`, jamais en
  baisse) et `location_code` changent. Marque, modèle, année, statut, propriétaire, notes : écrits à la
  création seulement. Une fiche supprimée logiquement est ignorée (anomalie).
- **Chauffeur** : `employee_number = TAY-NNN` (colonne N° du classeur, sur trois chiffres) ; le classeur
  n'a pas de matricule. `cpc_status` n'est jamais écrit.
- **Fournisseur** : nom normalisé (casse, accents, espaces multiples) ; seule la catégorie est mise à jour.

Chaque upsert est `ON CONFLICT … DO UPDATE … WHERE (ligne) IS DISTINCT FROM (cible)` : un second
`--apply` fait zéro écriture (aucune ligne ne change de `xmin`). Le plan est recalculé dans la
transaction sous `pg_advisory_xact_lock(hashtext('import-tay'))` ; un écart entre plan et résultat
annule tout. Aucune suppression ni désactivation.

## Valeurs par défaut

Marque et modèle « Non renseigné » ; année = année d'émission de la carte grise (sinon carte bleue,
sinon visite technique), notée « année estimée » dans `notes` ; statut `operational` ; carburant `diesel` ;
`owner_id` NULL (TAY possède ses camions). Nom en un seul mot : prénom « Non renseigné ».
Numéro de châssis à la place de la plaque : la fiche est créée, `notes` le signale.

## Corrections automatiques signalées

Une plaque hors modèle du suivi kilométrique, à une seule frappe (insertion, suppression ou
remplacement) d'une seule plaque conforme du suivi documentaire, lui est rattachée ; l'anomalie
« plaque corrigée » donne `ancienne -> retenue`. Plusieurs candidates : aucune correction.

## Véhicule fictif

`TEST-0001`, marque et modèle « Véhicule de test », échéances entre 6 et 12 mois (conservées tant
qu'elles restent dans cette fenêtre, pour rester idempotent d'un jour à l'autre). `--no-test-vehicle`
l'omet.

## Audit et lot

`created_by` = utilisateur `admin` là où la colonne existe. Écart connu au §5 d'AGENTS.md :
`vehicles` n'a que `created_by`, `drivers` n'a aucune colonne d'audit, `suppliers` a `created_by` et
`updated_at`. Le script n'ajoute pas de colonne.
Si `import_batches.file_sha256` existe, un lot (empreinte composite des quatre fichiers) est écrit
une fois et relié aux véhicules créés (`vehicles.import_batch_id`).
