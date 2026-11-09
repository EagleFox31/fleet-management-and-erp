## 2026-11-04 14:14 — #286 : fusion de #278 et de main, échec dépendant de l'ordre (#293)

- **Quoi** : fusion de `fix/login-identifier-digest` (#278) et de `main` dans `fix/change-password-attempts`. Commentaire de `keyOf` placé au-dessus de son champ dans `LockoutGuardOptions`.
  - Filtre de reprise : les préfixes sans nom saisi (`pin:`, `cpw:`, empreinte) de #286 sont combinés avec la clause M-3 de #278 (nom numérique rangé dans `entity_id`).
- **Comment** : conflits résolus bloc par bloc, sans `checkout --ours` (near miss consigné dans LESSONS). LESSONS fusionné en union, sans entrée en double.
- **Pourquoi** : chaque PR de la pile ne doit montrer que son sujet face à `main`.
- **Diagnostic #293** (« R8 : pin-login, compte inconnu et PIN faux ») :
  - le test passe seul et n'échoue que dans la suite complète des contrats, selon l'ordre d'exécution ;
  - cause : plusieurs fichiers de contrat utilisent le même identifiant chauffeur inexistant, donc le même compteur d'échecs `pin:999999999` sur la base de test partagée. Selon l'ordre, ce compteur est déjà au seuil ;
  - piste : un identifiant inexistant propre à chaque fichier, ou le nettoyage de ce compteur (`storedLockoutKey`) avant chaque cas.

