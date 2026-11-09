## 2026-11-03 — Lot A4 : cloison client des lectures pneus et garde en échec fermé

- **Quoi** : contrat `client-read-scope-tires.contract.test.ts` (53 cas) : `/api/vehicle-tires` cloisonné par client (client sans véhicule -> vide), 12 routes pneus réservées au personnel (client 403, technicien et responsable 200), 17 chemins masqués par un montage (client 403), règlement fournisseur, `?vehicleId` hors plage en 400, client `B&A` en 403 sur le carburant. Scan `route-guard-scan.ts` réécrit, 25 tests d'hygiène.
- **Comment** : acteurs manager, technicien, chauffeur, magasinier, clients A, B et sans véhicule ; données `TEST*` (pneu, 2 pneus montés, 3 inspections, 2 rotations) supprimées en `afterAll`, balayage d'orphelins étendu. Scan par classification de la source des gardes, identifiant inconnu = permissif.
- **Pourquoi** : dernière famille de fuites de lecture côté client (récidive des lots A1 à A3) et garde qui acceptait un nom de garde sans en lire le rôle.
- **Preuves** : rouge sur `routes.ts` de main : 21 échecs sur 53 ; vert 53/53. Mutation : `routes-hygiene` 1 échec / 24 réussis. Liste gelée 52 -> 22, liste non analysable 1. tsc 0, unitaires 1773/1773, familles de contrat 54 fichiers / 869 tests.

