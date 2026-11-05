# Accents des libelles du StatusBadge generique

## Quoi
Les 14 libelles de `STATUS_LABEL` retrouvent leurs accents (Approuvée, Reçue, Émise, Clôturée...).

## Comment
Accents seuls, aucun changement de vocabulaire : `issued` reste « Émise » (sens facture), le vocabulaire stock de AGENTS.md §1 n'est pas propage. Test `status-badge-accents.test.ts`. Aucun test ni e2e ne cherchait l'ancien texte non accentue.

## Pourquoi
Francais correct en UI ; demande de l'orchestrateur apres #439. Branche empilee sur #439 (meme fichier).
