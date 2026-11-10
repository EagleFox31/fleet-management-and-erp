## V3 : bons de carburant activés par défaut

**Quoi** : le drapeau `fuel-vouchers` passe à `defaultEnabled: true` dans `shared/feature-flags.ts`, après un e2e du parcours principal (`e2e/32-fuel-vouchers.spec.ts`).
**Comment** : la logistique valide un bon en attente depuis `/fuel/vouchers` (le bon quitte la liste « En attente », `validation_status` et `validated_by` en base). Le chef d'atelier, ouvert sur le même écran, reçoit la trame `fuel_record_validated` et n'a pas de bouton « Valider ». Le rejeu répond 409 avec `FUEL_VOUCHER_STALE_MESSAGE` (plein validé figé, corrections par `POST /api/fuel-records/:id/cancel`), le chef d'atelier et le technicien reçoivent 403. `fuel-vouchers` rejoint `SHOULD_ACTIVATED_AFTER_RECETTE`.
**Pourquoi** : pas de `FEATURE_FLAGS` sur le VPS ; l'activation passe par le défaut versionné. Débloquée par #630 et #633 (verrou en base des pleins validés).
**Preuve** : e2e `32-fuel-vouchers` 2 passés (Postgres local, `E2E_SKIP_ACCOUNT_CHECK=1` car le spec crée ses comptes) ; unitaires verts hors `db-pool-options` (échec local connu) ; contrats feature-flags / fuel-vouchers verts.
