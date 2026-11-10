## 2026-11-09T18:27:00+01:00 — Landing : vidéo de démonstration par profil

- **Statut** : fait (PR)
- **Quoi** :
  - `client/public/demos/*.mp4` : 7 tutoriels par profil (chef d'atelier, technicien, magasin, logistique, secrétariat, direction, chauffeur), réencodés en 720p H.264 (CRF 28, faststart), 14 Mo au total contre 103 Mo en 1080p. Données de démonstration uniquement ;
  - `client/src/pages/landing.tsx` : table `PROFILE_DEMO_VIDEOS` (id de profil → fichier), mention « Vidéo » sur la carte du profil, lecteur dans la fenêtre « Guide » au-dessus des étapes. Admin et client n'ont pas de vidéo, rien ne s'affiche pour eux.
- **Comment tester (QA)** : ouvrir `/landing`, section « 9 Profils Métier » : 7 cartes portent « Vidéo » ; cliquer « Chef d'Atelier » : le lecteur affiche 1:28 et se lit. Vérifié sur un build servi en statique (Playwright : 7 badges, durée 88,8 s).
- **RAIDER** : R : table de correspondance unique ; D : guide existant inchangé ; E : vidéos servies en statique, requêtes partielles (206) non mises en cache par le service worker.
- **Reste / risques** : les vidéos datent du 06/11 (page pneus absente de la vidéo magasin) ; à retourner si les écrans changent.
