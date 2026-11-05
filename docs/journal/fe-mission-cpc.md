# Journal fe-mission-cpc

## 2026-11-05 - Assistant de mission : message clair quand le CPC bloque « Suivant »

**Quoi.** À l'étape 3, un chauffeur dont le CPC n'est pas à jour affiche une alerte (`data-testid="cpc-block-guidance"`) qui dit pourquoi (non à jour, expiré, non renseigné, date future) et quoi faire. Rôles admin, logistique et secrétariat : choisir un autre chauffeur ou renseigner la date de formation CPC dans la fiche. Autres rôles : choisir un autre chauffeur ou demander à la logistique ou au secrétariat.

**Comment.** Fonction pure `getCpcBlockGuidance(driver, role)` dans `client/src/lib/mission-wizard-rules.ts`, qui réutilise `getDriverCpcEligibility` (aucune règle nouvelle). `pages/missions/new.tsx` l'affiche à la place de la ligne générique « Chauffeur non éligible ». Les rôles proposant la correction sont ceux de `POST /api/drivers/:id/update-cpc` (`isDriverManager`).

**Pourquoi.** Le blocage existait et la garde serveur est la même, mais le retour se limitait à une ligne sans consigne. Ce n'est pas un bug de règle : la garde lit le statut enregistré (`cpcStatusRecorded`), la liste recalcule l'affichage depuis `cpcTrainingDate`.

**Correctifs de relecture.** Les rôles viennent de `DRIVER_MANAGER_ROLES` (`shared/constants/roles.ts`), lue par `isDriverManager` côté serveur et par `canManageDrivers` côté client. La consigne cite le formulaire « Mise à jour des certifications CPC » (bouton « Enregistrer validation »), qui recalcule toujours le statut : `buildDriverPatchPayload` n'envoie pas une date inchangée, donc ressaisir la même date dans la fiche ne débloque rien.

**Deux cas de divergence connus (règle inchangée, question posée à l'utilisatrice).**
- (a) Affiché « formé » mais bloqué : le statut enregistré n'a jamais été recalculé, la garde lit lui et non l'affichage.
- (b) Marge de 59 jours : `calculateCPCStatus` enregistre « À FORMER » 59 jours avant l'expiration ; la garde bloque alors que la formation est encore valable. Le commentaire de `driver-cpc-eligibility.ts` affirmait le contraire ; il est corrigé, la règle n'est pas touchée.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client/mission-wizard-cpc-guidance.test.ts tests/unit/client/mission-wizard-rules.test.ts`.

## Consigne suivable par rôle

Le formulaire « Mise à jour des certifications CPC » n'est rendu que sur le tableau de bord du secrétariat (App.tsx : un tableau de bord par rôle ; admin et logistique ont le leur, sans ce formulaire). La consigne dit donc au secrétariat de l'utiliser depuis son tableau de bord ; admin, logistique et les autres rôles sont renvoyés vers le secrétariat. POST update-cpc autorise toujours admin et logistique : exposer le formulaire sur la fiche chauffeur (drivers/[id].tsx) est le suivi prévu, la consigne pourra alors pointer vers la fiche.

## 2026-11-05 — La consigne CPC pointe vers la fiche chauffeur

**Quoi.** `getCpcBlockGuidance` renvoie désormais vers la fiche du chauffeur (formulaire « Mise à jour des certifications CPC », ajouté par #380) et non plus vers le tableau de bord du secrétariat. Le retour gagne `driverHref` (`/drivers/<id>`), affiché en lien « Ouvrir la fiche du chauffeur » à l'étape 3.

**Comment.** Les rôles qui voient le lien sont ceux de `canManageDrivers` (admin, logistique, secrétariat), identiques à la garde de la route `/drivers/:id` (`RoleRoute allowedRoles={DRIVER_MANAGER_ROLES}`) et à `isDriverManager` sur `POST /api/drivers/:id/update-cpc`. Les autres rôles lisent « demandez à l'administrateur, à la logistique ou au secrétariat… » sans lien ; la phrase est dérivée de `DRIVER_MANAGER_ROLES` (table typée `Record<DriverManagerRole, string>`). Sans identifiant de chauffeur, texte seul.

**Pourquoi.** Admin et logistique étaient renvoyés vers le secrétariat faute de formulaire sur leur écran ; depuis #380 ils peuvent corriger eux-mêmes, et aucun rôle n'est envoyé vers un écran qui répond 403.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client/mission-wizard-cpc-guidance.test.ts` (rouge avant correctif : 4 échecs ; vert après : 10).
