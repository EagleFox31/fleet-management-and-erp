## 2026-11-05T05:00:00+01:00 — Démos 01 et 05 : geste Commencer du technicien, mineurs du seed (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le démarrage d'une intervention est fait par le technicien (bouton « Commencer »), plus par le chef d'atelier ; deux mineurs de relecture du seed levés.
- **Comment** : 01 : l'OT du seed est `pending`, le technicien l'ouvre dans « En attente » et le démarre. 05 : le chef crée et assigne à un technicien de démo dédié (`demotech2`, l'assignation du technicien principal étant refusée par un conflit de créneau avec son OT en attente), déconnexion par le menu, le technicien démarre, le chef clôture. `loginThroughForm` reclique si le premier clic après démarrage du serveur n'a pas déclenché l'appel de connexion ; `ensureUser` réconcilie aussi le nom ; échéances de papiers écrites seulement si la date diffère ; mouvements d'entrée des réceptions précédentes purgés (11 avant et après deux seeds consécutifs).
- **Comment tester (QA)** : specs 01 et 05 vertes sur 2 passages avec rejeu du seed (05 : 41 s de vidéo), 06 verte sur 2 passages ; `npm run check` 0 erreur, unitaires 202 fichiers / 2335 tests.
- **RAIDER** : I (écritures seulement si l'état diffère, purge des mouvements) ; ne s'applique pas : code produit.
- **Reste / risques** : l'assignation d'un OT à un technicien déjà affecté en attente répond 409 (conflit de créneau, comportement produit).

