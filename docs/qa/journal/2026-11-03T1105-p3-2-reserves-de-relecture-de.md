## 2026-11-03 11:05 — P3-2 : réserves de relecture de #135

- **Quoi** : le scan d'hygiène du miroir voit désormais `.set({ ...p })`, `vehicles as v`, `.update(schema.vehicles)`, `UPDATE "public"."vehicles"` et `onConflictDoUpdate` ; les tests d'éligibilité ne dépendent plus du fuseau de la machine ; l'id du 404 est lu en base.
- **Comment** : `vehicle-mirror-write-hygiene.test.ts` (regex élargies, alias signalé, upsert scanné) ; `document-expiry-day-j.test.ts` fixe `TZ=Africa/Douala` le temps du fichier et passe des `Date` locales à l'éligibilité ; contrat : `max(vehicle_documents.id) + 1`.
- **Pourquoi** : réserves 1 à 3 de la relecture. Nouveau défaut D4 : le service compte en date UTC, l'éligibilité en date locale ; à 23:30Z (00:30 à Douala) une assurance échéant le lendemain bloque l'une et pas l'autre, même après correction de D1. Arbitrage produit sur la date de référence.
- **Preuves** : rouge avant : fichier sonde temporaire avec les 5 formes, chacune vue (4 écritures miroir, 1 générique, 1 alias), sonde supprimée, liste gelée inchangée (aucun site réel nouveau) ; D4 en `it.fails` rougit quand le service compte en date locale. Vert après : `tsc` 0 erreur, `npm test` 1599/1599, contrat 9/9 sur fleet_test_p32gf2 (supprimée par dropdb).

