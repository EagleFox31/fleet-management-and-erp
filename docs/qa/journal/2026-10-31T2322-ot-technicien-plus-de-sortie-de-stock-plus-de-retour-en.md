## f81714f - OT technicien : plus de sortie de stock, plus de retour en arrière (WO2)

**Quoi**
- `PATCH /api/technician/work-orders/:id/status` n'accepte plus de pièces : 400 avec un message qui
  renvoie vers la demande au magasin. L'écran « Mes ordres de travail » remplace le bloc « Pièces
  utilisées » par un lien vers la fiche de l'OT.
- Transitions autorisées au technicien : en attente → en cours, en cours → en cours / terminé,
  en attente de pièces → en cours. Un OT terminé ou annulé est refusé (409).
- Statut inconnu : 400. Kilométrage inférieur à celui du véhicule : 400, rien n'est écrit.

**Comment**
- Route déplacée de `server/routes.ts` vers `server/api/technician-work-orders.routes.ts` (Zod,
  `AppError`, `moduleLogger`). Tout est vérifié avant la première écriture.
- Table des transitions : `shared/constants/technician-work-order-transitions.ts`.

**Pourquoi**
- Décision métier : le technicien ne se sert pas au magasin, il demande la pièce pendant la
  réparation et le magasinier la sort. L'ancienne route décrémentait le stock elle-même, avalait les
  erreurs (« Statut mis à jour » affiché alors que la pièce n'était pas enregistrée), insérait la
  ligne de pièce avant la sortie de stock hors transaction, acceptait n'importe quel statut
  (`n_importe_quoi` enregistré en base) et ignorait sans prévenir un kilométrage plus bas.

**Preuve**
- Contrat `technician-work-order-status` 7/7 ; 5 cas rouges sur l'ancienne route (200 au lieu de
  400/409). Avec `work-order-parts`, `work-order-quality-check`, `api-auth-guard` : 22/22.
- Unitaire 802/802 ; `npm run check` 0 erreur.

**Reste**
- `POST /api/work-orders/:id/parts` (« demander une pièce », `requestPartForWorkOrder`) sort encore
  directement du stock la quantité disponible quand le demandeur est technicien. Contraire à la même
  décision ; à traiter à part (change le circuit des demandes).

