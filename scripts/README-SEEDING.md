# Guide de Seeding Production - Yaro FleetOS

## 📋 Vue d'ensemble

Ce guide explique comment importer les données réelles depuis les fichiers Excel dans la base de données de production lors du déploiement.

## 🎯 Script Principal

**Fichier**: `scripts/seed-production-data.ts`

Ce script consolide toutes les migrations de données provenant des fichiers Excel dans un seul processus automatisé.

## 📊 Données Importées

Le script importe les données suivantes dans l'ordre:

1. **👥 Utilisateurs par défaut** (7 utilisateurs de test)
   - admin / admin123
   - workshop_manager / workshop123
   - technician / tech123
   - secretary / secretary123
   - logistics / logistics123
   - warehouse / warehouse123
   - client / client123

2. **📦 Fournisseurs** (12 fournisseurs réels)
   - Source: `GESTION FOURNISSEURS AU 06 08 2025.xlsx`
   - CFAO MOBILITY, ACCORD BOURGNE, BERNABE, AUTO SERVICE, etc.

3. **🚛 Véhicules** (flotte complète)
   - Source: `SUIVI DES CAMION TAY.xlsx`
   - Feuille: "SUIVI 2025"
   - Avec soft delete des véhicules existants

4. **📄 Factures Fournisseurs**
   - Source: `GESTION FOURNISSEURS AU 06 08 2025.xlsx`
   - Toutes les factures par fournisseur
   - Calcul automatique de la TVA (19.25%)

5. **⛽ Enregistrements Carburant**
   - Source: `EXEMPLAIRE SUIVI TRESORERIE.xlsx`
   - Feuille: "Recap Cartes"

## 🚀 Comment Exécuter

### Option 1: Avec tsx (Recommandé)

```bash
npx tsx scripts/seed-production-data.ts
```

### Option 2: Avec Node.js (après compilation)

```bash
tsx scripts/seed-production-data.ts
```

### Option 3: Ajouter un script npm (Optionnel)

Si vous souhaitez ajouter un raccourci dans `package.json`:

```json
"scripts": {
  ...
  "seed:production": "tsx scripts/seed-production-data.ts"
}
```

Puis exécuter:

```bash
npm run seed:production
```

## ⚠️ Précautions

### Avant l'Exécution

1. **Vérifier l'environnement**
   - Assurez-vous que `DATABASE_URL` pointe vers la base de données correcte
   - En production, vérifiez que c'est bien la base de données de production

2. **Backup de la base de données**
   ```bash
   # Créer un backup avant seeding (recommandé)
   pg_dump $DATABASE_URL > backup_avant_seeding.sql
   ```

3. **Vérifier les fichiers Excel**
   - Les fichiers source doivent être dans `attached_assets/`
   - Vérifier que les noms correspondent exactement

### Comportement du Script

- **Utilisateurs**: Ignore les doublons (par username)
- **Fournisseurs**: Ignore les doublons (par nom)
- **Véhicules**: Effectue un soft delete avant import
- **Factures**: Ignore les doublons (par numéro de facture)
- **Carburant**: Import additionnel

## 📝 Logs et Débogage

Le script affiche des logs détaillés:

```
╔═══════════════════════════════════════════════════════════╗
║         SEEDING PRODUCTION - YARO FLEETOS                 ║
╚═══════════════════════════════════════════════════════════╝

➡️  ÉTAPE 1/5: Utilisateurs par défaut
✅ Utilisateur créé: admin (admin)
...

📊 RÉSULTATS:
   ✅ Créés: 7
   ⏭️  Ignorés: 0
   👥 Total: 7

➡️  ÉTAPE 2/5: Fournisseurs
...
```

### En Cas d'Erreur

Le script:
- Affiche l'erreur exacte
- Quitte avec code d'erreur 1
- Permet de réessayer sans perte de données (gestion des conflits)

## 🔄 Ré-exécution

Le script est **idempotent** - vous pouvez l'exécuter plusieurs fois sans créer de doublons grâce aux clauses `onConflictDoNothing`.

```bash
# Ré-exécuter en toute sécurité
npx tsx scripts/seed-production-data.ts
```

## 📦 Fichiers Sources Requis

Assurez-vous que ces fichiers existent dans `attached_assets/`:

- ✅ `GESTION FOURNISSEURS AU 06 08 2025_1759172016981.xlsx`
- ✅ `SUIVI DES CAMION TAY_1759172136545.xlsx`
- ✅ `EXEMPLAIRE SUIVI TRESORERIE_1759168900037.xlsx`
- ✅ `EXEMPLAIRE SUIVI MAINTENANCE_1759172146452.xlsm`

## 🎓 Structure du Code

```typescript
// Utilitaires communs
parseNumber()           // Convertir valeurs Excel en nombres
excelDateToJSDate()     // Convertir dates Excel en JS Date
formatDateForDB()       // Formater dates pour PostgreSQL

// Fonctions de seeding
seedUsers()             // Créer utilisateurs par défaut
seedSuppliers()         // Importer fournisseurs
seedVehicles()          // Importer véhicules
seedSupplierInvoices()  // Importer factures
seedFuelRecords()       // Importer carburant

// Fonction principale
runProductionSeeding()  // Orchestre tout le processus
```

## 🔧 Personnalisation

Pour ajouter de nouvelles données:

1. Créer une fonction `async function seedNouvellesDonnees()`
2. Suivre le pattern des fonctions existantes
3. Ajouter l'appel dans `runProductionSeeding()`
4. Mettre à jour le résumé final

## 📊 Résumé Final

À la fin de l'exécution, vous verrez:

```
╔═══════════════════════════════════════════════════════════╗
║                  SEEDING TERMINÉ ! ✅                     ║
╚═══════════════════════════════════════════════════════════╝

📊 RÉCAPITULATIF GLOBAL:

   👥 Utilisateurs: 7 créés
   📦 Fournisseurs: 12 importés
   🚛 Véhicules: 45 importés
   📄 Factures: 156 importées
   ⛽ Carburant: 234 enregistrements

⏱️  Durée totale: 8.42s

✅ La base de données est prête pour la production!
```

## 🆘 Support

En cas de problème:

1. Vérifier les logs détaillés
2. Vérifier que `DATABASE_URL` est correctement configuré
3. S'assurer que tous les fichiers Excel sont présents
4. Vérifier les permissions de la base de données

## 📚 Références

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [XLSX Library](https://www.npmjs.com/package/xlsx)
- [Neon Serverless PostgreSQL](https://neon.tech/)
