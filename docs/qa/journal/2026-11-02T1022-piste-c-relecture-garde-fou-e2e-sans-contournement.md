## Piste C, relecture : garde-fou e2e sans contournement

**Quoi**
- `playwright.config.ts` : `reuseExistingServer: false`. Un serveur déjà lancé sur le port (donc potentiellement sur la production) n'est plus réutilisé.
- `e2e/helpers/production-guard.ts` : `hostOf` renvoyait `""` pour une URL sans `user@`, ce qui laissait passer la production. L'autorité entière est maintenant l'hôte.
- `e2e/README.md` : phrase sur le refus précisée (base visée par la session), limite `E2E_BASE_URL` détaillée.
- Fusion de `docs/couverture-apres-correctifs` (#81) : ligne T8 du plan reprise de #81, entrées de journal conservées toutes deux, ligne vide ajoutée avant l'étape 2.

**Comment**
- `tests/unit/e2e/production-guard.test.ts` : URL de production sans identifiants (hôte, marqueur, refus) et verrou sur `reuseExistingServer`.

**Pourquoi**
- Le garde-fou ne voit que la `DATABASE_URL` de la session : réutiliser un serveur existant le contournait. Une URL sans identifiants est valide pour `pg`.

**Preuve**
- Rouge sur le code d'avant (les deux fichiers sources restaurés) : 2 échecs sur 16. Vert après : 16/16.


