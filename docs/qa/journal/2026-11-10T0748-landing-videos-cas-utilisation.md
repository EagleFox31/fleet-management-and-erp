# Landing : vidéos de démonstration au format cas d'utilisation

**Quoi.** Les 7 vidéos de `client/public/demos/` sont remplacées par la version « cas d'utilisation » :
titre verbe + groupe nominal, acteur, précondition, connexion montrée, tableau de bord décrit point par point,
étapes numérotées acteur / système, postcondition. Voix ralentie, sous-titres agrandis.

**Comment.** Rendus 1080p réencodés en 720p (H.264 CRF 28, AAC 64k, faststart), mêmes noms de fichiers :
aucun changement de code, `PROFILE_DEMO_VIDEOS` de `landing.tsx` est inchangé.

**Pourquoi.** Retour utilisatrice du 9 novembre : les titres « Profil : module » étaient bruts ; les clients
ne sont pas à l'aise en français. La vidéo direction montre la rentabilité par camion, les camions à
remplacer et le chiffre d'affaires, sur des données de démonstration signalées à l'écran.
