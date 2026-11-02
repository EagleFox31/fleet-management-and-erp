# Journal fe-veh3 : abandon d'un brouillon d'acquisition

## 2026-11-02 : bouton Abandonner sur le bandeau, brouillon tardif neutralisé

- **Agent** : fe-veh3 · **Branche** : `fix/vehicle-acquisition-ui` · **Commit** : voir PR
- **Statut** : fait
- **Quoi** : le bandeau « Workflows en cours » (`WorkflowReminders` compact, page véhicules) propose « Abandonner » ; le brouillon passe en `abandoned` et disparaît du bandeau et de la reprise (VEH3-UI-1). `use-workflow-persistence.ts` n'enregistre plus un brouillon après `completed` (VEH3-UI-2).
- **Comment** : mutation `{ sessionId }` par variables, `apiRequest`, `userMessageOf` pour l'erreur ; couche 1 retrait du cache `/api/workflows/active`, couche 3 invalidation active, stats et reprise ; couche 2 sans objet (brouillon propre à son auteur). E2E : `test.fail` retirés, test d'abandon vérifié en base ; nettoyage des véhicules supprime d'abord l'ordre de travail ouvert par l'activation (FK).
- **Pourquoi** : un brouillon laissé en route ne pouvait pas être abandonné depuis l'interface ; le brouillon `in_progress` recréé après activation polluait le bandeau.
- **Comment tester (QA)** :
  - Prérequis : compte `workshop_manager`, un brouillon d'acquisition en cours.
  - Étapes : ouvrir `/vehicles`, cliquer « Abandonner » sur le bandeau.
  - Attendu : le brouillon disparaît, la reprise par URL ne le retrouve plus.
  - Preuve : `e2e/16-vehicle-acquisition-resume.spec.ts` 5 tests verts (4 en run complet + abandon rejoué après correction du nettoyage) ; tsc 0 erreur ; vitest 917 passed.
- **RAIDER** : R/D (contrats intacts), I (abandon répété sans effet), failure memory : la 1re exécution a échoué sur page blanche (compilation à froid de Vite) puis sur un nettoyage bloqué par une clé étrangère.
- **Reste / risques** : pas de capture d'écran de rôle refusé ; le bandeau n'est visible que pour le propriétaire du brouillon.
