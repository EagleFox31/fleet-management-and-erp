# Emoji dans l'UI : tranche 2

## Quoi
Sept fichiers sans emoji : icônes `lucide-react` (Check dans les étapes de commande, AlertTriangle sur facture en retard, User dans l'historique de stock, X avec aria-label « Fermer » sur la carte du corridor) ; trois alertes du tableau de bord sans « ✓ » final (le texte suffit).

## Reste gelé
playful-error-messages (supprimé par #425) et les emoji hors écran : console.* de fleet-status, settings, use-workflow-persistence ; commentaire de form-drafts.

## Preuve
Cliquet abaissé dans le même commit ; test exact vert ; check 0 erreur TS ; npm test complet vert.
