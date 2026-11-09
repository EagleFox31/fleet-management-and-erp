## Lot ADM5, ADM6, DRV1 - PIN chauffeur, journal d'activité des comptes, fiche chauffeur

**Quoi**
- `driver-pin-login` (ADM5, 7 cas) : bon PIN ouvre une session, mauvais PIN, compte supprimé, rôle
  autre que chauffeur, PIN absent et corps incomplet refusés sans cookie ; la liste PIN n'expose que
  `id` et `name`.
- `audit-sensitive-actions` (ADM6, 3 cas) : création, changement de rôle et suppression de compte
  écrivent une ligne `activity_logs` attribuée à l'admin, mot de passe masqué ; un 403 n'en écrit aucune.
- `drivers-crud-deactivation` (DRV1, 7 cas) : CRUD logistique, magasin refusé, désactivation réservée
  à l'admin ; un témoin (chauffeur actif affecté : 200) et trois `it.fails` (affectation, liste PIN,
  connexion PIN), mise en place en `beforeAll` pour qu'un échec de préparation ne passe pas pour le défaut.

**Pourquoi**
- Défauts constatés : un chauffeur désactivé reste affectable par `PATCH /api/missions/:id` (seul le CPC
  est vérifié, le refus n'arrive qu'au lancement) ; il reste sur l'écran PIN et s'y connecte, car
  `drivers-list` et `pin-login` lisent `users` seul. Correction à arbitrer, non faite ici.

**Preuve**
- Contrat 17/17 (dont les 3 `it.fails`) ; les cas rejoués en `it` échouent sur l'assertion finale
  (affectation 200 au lieu de 400, compte encore listé).

