## 179015d - Réception et sortie de pièce idempotentes (T7 stock)

**Quoi**
- Une double soumission de « Sortir la pièce du stock » ne décrémente plus deux fois.

**Comment**
- Compare-and-set sur le statut dans `updatePartRequirement` ; l'effet stock passe
  dans `onTransition(tx)`, dans la même transaction que le changement de statut.
- Garde `quantity >= n` dans l'`UPDATE` du stock.

**Pourquoi**
- Deux clics rapprochés ou un retry réseau produisaient deux mouvements de stock.
- Incident : LESSONS_LEARNED « Sortie de stock vers l'OT : double sortie possible ».

