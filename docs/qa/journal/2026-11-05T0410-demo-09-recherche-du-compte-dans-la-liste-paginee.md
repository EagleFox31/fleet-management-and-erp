## 2026-11-05T04:10:00+01:00 — Démo 09 : recherche du compte dans la liste paginée

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : la démo admin échouait une fois sur quatre passages (ligne `recrue1` introuvable en 30 s).
- **Comment** : la liste `/admin/users` est paginée par 10 sur une base partagée ; la spec saisit désormais le nom du compte dans le champ de recherche avant de viser la ligne. Cause probable (non reproduite à l'identique, artefacts écrasés par le passage suivant) : le compte sorti de la première page.
- **Comment tester (QA)** : 09 verte sur 2 passages avec rejeu du seed (20,6 s et 16,5 s) ; passage complet 01 à 10 : 10/10 au passage 2.
- **RAIDER** : D (indépendance vis-à-vis du volume de comptes) ; ne s'applique pas : code produit.
- **Reste / risques** : le diagnostic reste une hypothèse ; si le défaut revient, regarder le délai de la requête `/api/admin/users`.

