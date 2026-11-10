## 2026-11-10 13:00 - Test pin-login E1 : ne compter que les variantes de l'identifiant testé

**Quoi.** Dans `tests/contract/pin-login-hardening.contract.test.ts`, le contrôle « une seule clé de compteur pour l'identifiant du chauffeur » ne compte plus les clés d'autres identifiants (commit fe4c204c). Test seul, aucun code produit.

**Comment.** Le `LIKE 'pin:%<id>'` et le filtre `endsWith(id)` ramassaient aussi un identifiant plus long se terminant par les mêmes chiffres (ex. `pin:999999147` pour le compte 147). Le filtre retire maintenant le préfixe `pin:`, les espaces et les zéros en tête, puis compare à l'identifiant exact.

**Pourquoi.** Sur la base partagée, un compte voisin faisait échouer le test par intermittence sans défaut du verrouillage.

**Preuve.** Contrat `pin-login-hardening` rejoué sur la base locale `fm-c7` (résultat dans la PR).
