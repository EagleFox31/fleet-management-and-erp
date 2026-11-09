## Piste C, étape 3 : parcours P5 (pneu) et P6 (stock bas vers réapprovisionnement)

**Quoi**
- `tests/contract/p5-tire-lifecycle.contract.test.ts` : un pneu de bout en bout (entrée en stock par le magasinier, montage neuf, suppression refusée tant que monté, inspection par le technicien, rotation, démontage vers le stock, remontage explicite de l'usagé et refus du remontage implicite, rebut, suppression refusée au magasinier puis acceptée à l'admin, historique de 2 montages et 1 inspection conservé), stock vérifié en base à chaque étape.
- `tests/contract/p6-low-stock-to-restock.contract.test.ts` (3 cas) : sortie sous le seuil, alerte avec manque, commande du brouillon à confirmée (alerte inchangée), réception par le magasinier (+10, une entrée de stock à son nom), alerte levée, demande reçue, réception rejouée sans crédit ; réception refusée au technicien ; réception partielle qui laisse l'alerte.
- Plan : P5 et P6 passent à « Contrat OK ».

**Comment**
- Deux erreurs de mes hypothèses corrigées au premier passage : la position de pneu `rear_left` n'existe pas (le 400 attendu en 409 était un faux positif de validation) et rejouer `delivered` répond 200 sans créditer (comportement idempotent, vérifié par le stock).

**Pourquoi**
- Les maillons étaient testés isolément ; rien ne prouvait la chaîne ni la justesse du stock d'une étape à l'autre.

**Preuve**
- P5 vert 1/1, P6 vert 3/3, deux passages de suite (idempotence). Rouge sur la version fautive : P5 avec le crédit de l'usagé au démontage neutralisé (`tires-service-simplified.ts:512`, `+ 1` en `+ 0`) ; P6 avec le crédit de réception neutralisé (`procurement-service.ts:238`) : 2 des 3 cas échouent. Une première mutation sur `part-requirements-service.ts:430` laissait P6 vert : ce n'est pas le chemin de réception d'une commande, le test ne prétend pas le couvrir.

