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
