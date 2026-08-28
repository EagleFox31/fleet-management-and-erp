# Comptes utilisateurs — environnement Neon courant

> **Source de vérité** pour les tests QA sur la base en ligne connectée au projet (Neon).
> Dernière vérification : août 2026 — écran **Administration > Utilisateurs**.

Ces comptes remplacent les identifiants de démo (`technician`, `workshop_manager`, etc.) décrits dans les anciens seeds. **Ne pas lancer le seed** pour se connecter : utiliser les logins ci-dessous.

## Tableau de référence

| Rôle | Login | Nom affiché | Email | Mot de passe |
|------|-------|-------------|-------|--------------|
| Administrateur | `admin` | Administrateur Système | admin@fleet.com | `admin123` |
| Chef d'atelier (`workshop_manager`) | `terry` | Terry Koulibaly | terry@yaro.os | `workshop123` |
| Technicien (`technician`) | `ali` | Ali Sawadogo | alisawa@yaro.os | `tech123` |
| Secrétaire (`secretary`) | `dana` | Dana Del Rey | dana@yaro.os | `secretary123` |
| Logisticien (`logistics`) | `issouf` | Issouf Coulibaly | issouf@yaro.os | `logistics123` |
| Magasinier (`warehouse`) | `fatou` | Fatoumata Diallo | fatou@yaro.os | `warehouse123` |
| Chauffeur (`driver`) | `jean.mballa` | Jean Mballa | hatemenow045@gmail.com | PIN `1234` (inchangé) |

## Correspondance rôle → login (tests multi-profils)

| Profil métier dans les scénarios QA | Se connecter avec |
|-------------------------------------|-------------------|
| Admin | `admin` |
| Chef d'atelier | `terry` |
| Technicien | `ali` |
| Secrétaire | `dana` |
| Logisticien | `issouf` |
| Magasinier | `fatou` |
| Chauffeur | `jean.mballa` |

## Notes

- **Pas de compte `client`** dans l'environnement actuel (filtre « Client » = 0).
- Les comptes seed (`technician / tech123`, `workshop_manager / workshop123`, …) ne sont **pas** présents sur cette base sauf ajout explicite via `scripts/seed-production-data.ts`.
- En cas de mot de passe oublié : réinitialiser via **Administration > Utilisateurs** (compte `admin`).

## Environnement

| Contexte | URL |
|----------|-----|
| Développement local | http://localhost:5000 |
| Base de données | PostgreSQL Neon (voir `.env` → `DATABASE_URL`) |
