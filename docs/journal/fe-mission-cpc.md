# Journal fe-mission-cpc

## 2026-11-05 - Assistant de mission : message clair quand le CPC bloque « Suivant »

**Quoi.** À l'étape 3, un chauffeur dont le CPC n'est pas à jour affiche une alerte (`data-testid="cpc-block-guidance"`) qui dit pourquoi (non à jour, expiré, non renseigné, date future) et quoi faire. Rôles admin, logistique et secrétariat : choisir un autre chauffeur ou renseigner la date de formation CPC dans la fiche. Autres rôles : choisir un autre chauffeur ou demander à la logistique ou au secrétariat.

**Comment.** Fonction pure `getCpcBlockGuidance(driver, role)` dans `client/src/lib/mission-wizard-rules.ts`, qui réutilise `getDriverCpcEligibility` (aucune règle nouvelle). `pages/missions/new.tsx` l'affiche à la place de la ligne générique « Chauffeur non éligible ». Les rôles proposant la correction sont ceux de `POST /api/drivers/:id/update-cpc` (`isDriverManager`).

**Pourquoi.** Le blocage existait et la garde serveur est la même, mais le retour se limitait à une ligne sans consigne. Ce n'est pas un bug de règle : la garde lit le statut enregistré (`cpcStatusRecorded`), la liste recalcule l'affichage depuis `cpcTrainingDate`.

**Tester.** `node node_modules/vitest/vitest.mjs run tests/unit/client/mission-wizard-cpc-guidance.test.ts tests/unit/client/mission-wizard-rules.test.ts`.
