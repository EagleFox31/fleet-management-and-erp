## Correctif relecture PR #62 - alertes non lues accumulées d'un jour à l'autre

**Quoi**
- Une alerte non lue identique (type, titre, lien) bloque toujours la création, quelle que soit sa clé :
  le rappel quotidien ne repart qu'une fois l'alerte lue.
- Garde-fou `alerts-write-hygiene` (écritures sur `alerts` gelées) ; leçon dans `LESSONS_LEARNED.md`.

**Pourquoi**
- Relecture : avec la seule clé du jour, un OT en retard non lu pendant 20 jours donnait 20 alertes
  non lues par destinataire. Corrige la limite « rappel quotidien » de l'entrée précédente : seule une
  alerte **lue** revient le lendemain.

**Preuve**
- Intégration `alert-generation-dedupe` 8/8 (J+1 non lue : aucune création ; J+1 lue : rappel),
  unitaire 848/848, `tsc` 0 erreur. Garde-fou rouge sur main (4 appels par id seul).

