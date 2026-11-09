## 24fb32f - Le technicien ne saisit plus de plein (T1)

**Quoi**
- `isFuelRecordWriter` : admin, chef d'atelier, secrétaire, logistique. Le technicien reçoit 403 sur
  `POST /api/fuel-records`.
- Page `/technician/fuel` supprimée, avec son entrée dans le menu latéral, la barre basse et le fil
  d'Ariane : elle n'affichait que « Mes pleins » et serait restée vide.
- Le chauffeur n'est pas concerné : il saisit par sa mission (`POST /api/missions/:id/fuel-records`,
  limité au chauffeur affecté).

**Comment**
- Matrice RBAC (`auth-middleware.test.ts`) puis contrat `fuel-records-and-document-paths` : technicien
  ajouté aux refus ; non-régressions portées par le logisticien.

**Pourquoi**
- Règle donnée par le commanditaire : un technicien n'a pas de plein à enregistrer.

**Preuve**
- `npm run check` 0 erreur ; matrice RBAC 173/173 ; contrat carburant + routes secondaires 30/30.

