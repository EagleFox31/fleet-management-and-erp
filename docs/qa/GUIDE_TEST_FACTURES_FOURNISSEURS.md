# 📘 GUIDE DE TEST - FACTURES FOURNISSEURS (Étape 1.1.3)
## Workflow de Contrôle 3 Voies avec Validation Hiérarchique

**Module :** Procurement - Factures Fournisseurs  
**Date :** 21 octobre 2025  
**Fonctionnalité :** Contrôle 3 voies (Commande ↔ Facture), Validation hiérarchique, Détection d'écarts

---

## 🎯 OBJECTIF DU MODULE

Gérer le cycle complet des factures fournisseurs :
1. **Réception** de la facture fournisseur
2. **Validation technique** (comparaison avec commande d'achat)
3. **Approbation hiérarchique** (si écart < 5% ou match parfait)
4. **Enregistrement du paiement**

**Bénéfice clé :** Détection automatique des écarts ≥5% pour éviter les surfacturations

---

## 👥 RÔLES ET PERMISSIONS

### 🔹 **Admin** (Accès complet)
- ✅ Voir toutes les factures
- ✅ Créer des factures fournisseurs
- ✅ Valider techniquement
- ✅ Approuver les paiements
- ✅ Enregistrer les paiements
- ✅ Voir les écarts et statistiques
- ✅ Export Excel

### 🔹 **Workshop Manager (Chef d'atelier)** (Accès complet)
- ✅ Voir toutes les factures
- ✅ Créer des factures fournisseurs
- ✅ Valider techniquement
- ✅ Approuver les paiements
- ✅ Enregistrer les paiements
- ✅ Voir les écarts et statistiques
- ✅ Export Excel

### 🔹 **Secretary (Secrétaire)** (Validation uniquement)
- ✅ Voir toutes les factures
- ✅ Créer des factures fournisseurs
- ✅ Valider techniquement
- ❌ **NE PEUT PAS** approuver les paiements (réservé admin/workshop_manager)
- ✅ Voir les écarts et statistiques
- ✅ Export Excel

### 🔹 **Autres rôles** (Pas d'accès)
- ❌ Technician, Logistics, Warehouse, Client : Pas d'accès au module

---

## 🚀 COMMENT TESTER ?

### **ÉTAPE 1 : SE CONNECTER**

1. Allez sur votre application
2. Connectez-vous avec l'un des comptes suivants (voir `docs/qa/COMPTES_ENVIRONNEMENT.md`) :

   **Admin :**
   - Login: `admin` — Administrateur Système
   - Password: `admin123`

   **Chef d'atelier (workshop_manager) :**
   - Login: `terry` — Terry Koulibaly
   - Password: *(défini à la création du compte)*

   **Secrétaire (secretary) :**
   - Login: `dana` — Dana Del Rey
   - Password: *(défini à la création du compte)*

---

### **ÉTAPE 2 : ACCÉDER AU MODULE FACTURES FOURNISSEURS**

**Dans la sidebar (menu gauche) :**
1. Cliquez sur **"💰 Approvisionnement"** (section Procurement)
2. Vous verrez apparaître :
   - Fournisseurs
   - Commandes d'achat
   - **→ Factures Reçues** ← Cliquez ici !

**URL directe :** `/procurement/invoices`

---

## 📋 TESTS À EFFECTUER

### **TEST 1 : Créer une Facture Fournisseur**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Sur la page `/procurement/invoices`, cliquez **"Nouvelle Facture"**
2. Remplissez le formulaire :
   - **Fournisseur** : Sélectionnez un fournisseur (ex: TOTAL CAMEROUN)
   - **Commande d'achat** : Sélectionnez une commande existante (optionnel)
   - **Numéro facture** : Ex: `FACT-TOTAL-2025-001`
   - **Date facture** : Date du jour
   - **Date échéance** : Dans 30 jours
   - **Montant HT** : Ex: `500000` FCFA
   - **Quantité** : Ex: `10`
   - **Description** : Ex: "Pièces détachées moteur"
3. Cliquez **"Créer la facture"**

**Résultat attendu :**
- ✅ Facture créée avec statut **"Reçue"** (received)
- ✅ TVA calculée automatiquement (19.25%)
- ✅ Total TTC affiché
- ✅ Si commande liée : contrôle 3 voies automatique !

---

### **TEST 2 : Contrôle 3 Voies Automatique**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Scénario A : Match parfait (0% d'écart)**

1. Créez une commande d'achat pour **500 000 FCFA**
2. Créez une facture liée à cette commande pour **500 000 FCFA**
3. Allez sur la page de détails de la facture
4. **Résultat attendu :**
   - ✅ Badge **"Match parfait ✓"** (vert)
   - ✅ Variance : 0%
   - ✅ Recommandation : **"Approbation automatique suggérée"**

**Scénario B : Écart acceptable (< 5%)**

1. Créez une commande d'achat pour **500 000 FCFA**
2. Créez une facture liée à cette commande pour **520 000 FCFA** (écart de 4%)
3. **Résultat attendu :**
   - ⚠️ Badge **"Écart détecté"** (orange)
   - ⚠️ Variance : 4%
   - ⚠️ Recommandation : **"Révision manuelle requise"**

**Scénario C : Écart important (≥ 5%)**

1. Créez une commande d'achat pour **500 000 FCFA**
2. Créez une facture liée à cette commande pour **600 000 FCFA** (écart de 20%)
3. **Résultat attendu :**
   - 🚨 Badge **"Écart important !"** (rouge)
   - 🚨 Variance : 20%
   - 🚨 Recommandation : **"Escalade requise - Écart critique"**
   - 🚨 Alerte visible dans Dashboard Écarts

---

### **TEST 3 : Validation Technique**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Allez sur la page de détails d'une facture (statut "Reçue")
2. Vérifiez le contrôle 3 voies (montants, quantités)
3. Cliquez **"Valider"**
4. Confirmez la validation

**Résultat attendu :**
- ✅ Statut passe de **"Reçue"** → **"Validée"**
- ✅ Votre nom apparaît dans "Validé par"
- ✅ Date de validation enregistrée
- ✅ Bouton "Approuver" devient disponible

---

### **TEST 4 : Approbation Hiérarchique**

**👤 Rôles autorisés :** ⚠️ **SEULEMENT Admin et Workshop Manager**

**Étapes :**
1. **Connectez-vous en tant que Secretary** → Essayez d'approuver
2. **Résultat attendu :** 🚫 Erreur "Accès refusé - Seuls admin et workshop_manager peuvent approuver"
3. **Déconnectez-vous et reconnectez-vous en tant qu'Admin**
4. Allez sur la facture validée
5. Cliquez **"Approuver"**
6. Confirmez l'approbation

**Résultat attendu :**
- ✅ Statut passe de **"Validée"** → **"Approuvée"**
- ✅ Votre nom apparaît dans "Approuvé par"
- ✅ Date d'approbation enregistrée
- ✅ Bouton "Enregistrer Paiement" devient disponible

---

### **TEST 5 : Enregistrement du Paiement**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Sur une facture approuvée, cliquez **"Enregistrer Paiement"**
2. Remplissez :
   - **Montant** : Montant total ou partiel
   - **Date paiement** : Date du jour
   - **Méthode** : Virement, Chèque, Espèces, etc.
   - **Référence** : Numéro de virement/chèque
3. Cliquez **"Enregistrer"**

**Résultat attendu :**
- ✅ Statut passe de **"Approuvée"** → **"Payée"**
- ✅ Date et méthode de paiement enregistrées
- ✅ Solde = 0 FCFA
- ✅ Badge vert "Payée ✓"

---

### **TEST 6 : Dashboard Écarts**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Allez sur `/procurement/invoices/discrepancies`
2. OU cliquez sur **"Écarts à traiter"** dans la navigation

**Résultat attendu :**
- ✅ Liste des factures avec écarts ≥ 5%
- ✅ Tri par variance décroissante
- ✅ Badges rouges pour écarts critiques
- ✅ Détails : montant commande vs facture, % écart
- ✅ Actions rapides : Valider / Approuver / Contester

---

### **TEST 7 : Filtres et Recherche**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Sur `/procurement/invoices`, testez les filtres :
   - **Par statut** : Reçues, Validées, Approuvées, Payées, Contestées
   - **Par fournisseur** : Sélectionnez un fournisseur
   - **Par période** : Dates de début/fin
   - **Avec écarts seulement** : Toggle ON/OFF

**Résultat attendu :**
- ✅ Liste filtrée selon critères
- ✅ Compteurs mis à jour
- ✅ Recherche en temps réel

---

### **TEST 8 : Export Excel**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Sur `/procurement/invoices`, cliquez **"Exporter Excel"**
2. Fichier téléchargé automatiquement

**Résultat attendu :**
- ✅ Fichier `factures_fournisseurs_YYYYMMDD.xlsx` téléchargé
- ✅ Contient : toutes les colonnes (numéro, fournisseur, montants, statut, écarts)
- ✅ Données complètes et formatées

---

### **TEST 9 : Statistiques Globales**

**👤 Rôles autorisés :** Admin, Workshop Manager, Secretary

**Étapes :**
1. Sur `/procurement/invoices`, regardez les KPIs en haut :
   - Total factures
   - Montant total
   - Factures validées / approuvées / payées
   - Factures avec écarts

**Résultat attendu :**
- ✅ Chiffres mis à jour en temps réel
- ✅ Graphiques : évolution, répartition par statut
- ✅ Top 5 fournisseurs

---

## 🔄 WORKFLOW COMPLET (Cas d'usage réel)

### **Scénario : Réception d'une facture TOTAL CAMEROUN**

**Jour 1 - 09h00 : Réception (Secretary)**
1. Secretary reçoit facture TOTAL par email
2. Se connecte et va sur `/procurement/invoices/new`
3. Crée la facture :
   - Fournisseur : TOTAL CAMEROUN
   - Commande : #CMD-2025-0042
   - Numéro : FACT-TOTAL-2025-156
   - Montant HT : 2 500 000 FCFA
4. Sauvegarde → **Statut : Reçue**

**Jour 1 - 10h00 : Validation Technique (Secretary)**
1. Secretary ouvre la facture
2. Voit le contrôle 3 voies : Écart +2.5% (acceptable)
3. Vérifie les quantités et montants
4. Clique "Valider" → **Statut : Validée**

**Jour 1 - 14h00 : Approbation (Workshop Manager)**
1. Workshop Manager reçoit notification
2. Ouvre la facture validée
3. Revoit l'écart de 2.5%
4. Vérifie la justification
5. Clique "Approuver" → **Statut : Approuvée**

**Jour 5 - Paiement (Admin)**
1. Admin fait le virement bancaire
2. Ouvre la facture approuvée
3. Clique "Enregistrer Paiement"
4. Montant : 2 562 500 FCFA (TTC)
5. Méthode : Virement
6. Référence : VIR-2025-0089
7. Sauvegarde → **Statut : Payée ✓**

**✅ Workflow terminé !**

---

## 🚨 CAS D'ALERTE : Écart ≥ 5%

### **Scénario : Facture avec surfacturation**

**Situation :**
- Commande d'achat : 1 000 000 FCFA
- Facture reçue : 1 200 000 FCFA (écart +20%)

**Workflow :**
1. Secretary crée la facture
2. **🚨 ALERTE AUTOMATIQUE** : Badge rouge "Écart critique 20%"
3. Facture apparaît dans `/procurement/invoices/discrepancies`
4. Secretary ne peut **PAS** valider (bouton désactivé)
5. **Email automatique** envoyé à Admin + Workshop Manager
6. Admin contacte le fournisseur
7. Options :
   - **Accepter** : Admin/Workshop Manager force la validation avec justification
   - **Contester** : Statut → "Disputée", facture rejetée
   - **Correction** : Fournisseur envoie facture corrigée

---

## 📊 INDICATEURS DE SUCCÈS

Après vos tests, vous devriez avoir :

✅ **Factures créées avec différents scénarios**
✅ **Contrôle 3 voies fonctionnel** (match parfait, écarts acceptables, écarts critiques)
✅ **Workflow de validation** respecté (Reçue → Validée → Approuvée → Payée)
✅ **Permissions par rôle** vérifiées (Secretary ne peut pas approuver)
✅ **Dashboard écarts** montrant les factures problématiques
✅ **Export Excel** téléchargeable
✅ **Statistiques** à jour

---

## 🎯 POINTS CLÉS À RETENIR

1. **Contrôle 3 voies automatique** : Compare facture vs commande dès la création
2. **Seuil de 5%** : Écart ≥ 5% = Escalade obligatoire
3. **Validation hiérarchique** : 
   - Secretary peut valider
   - Seul Admin/Workshop Manager peut approuver
4. **Traçabilité complète** : Qui a validé ? Qui a approuvé ? Quand ? Montant payé ?
5. **Alertes visuelles** : Badges colorés (vert/orange/rouge) selon gravité

---

## 📞 SUPPORT

Si vous rencontrez des problèmes :
1. Vérifiez que vous êtes connecté avec le bon rôle
2. Vérifiez qu'une commande d'achat existe pour tester le contrôle 3 voies
3. Consultez les logs du serveur pour les erreurs backend

**Bon test !** 🚀
