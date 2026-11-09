## 2026-11-06T14:10:00+01:00 — Rapports de direction : sous-titre aligné sur le drapeau report-schedules

- **Agent** : de (fleet-testeur) · **Branche** : `fix/reports-subtitle-flag` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : le sous-titre de `/management/reports` annonçait la « distribution automatisée » même drapeau `report-schedules` éteint, alors que l'onglet d'envoi est masqué depuis #588.
- **Comment** : `reportsPageSubtitle(flags)` dans `client/src/lib/management-report-tabs.ts` réutilise `isReportTabEnabled` sur l'onglet d'envoi.
- **Comment tester (QA)** : un cas ajouté à `tests/unit/client/management-report-tabs.test.ts` : avec le drapeau éteint (et avec les défauts du catalogue), aucune mention de la distribution ; avec le drapeau allumé, le texte d'origine. Campagnes : unitaires 303/303, tsc 0, check:tests 0.
- **RAIDER** : R (même garde que les onglets) ; D (texte inchangé drapeau allumé). Ne s'applique pas : A, I, Retroactive.
- **Reste / risques** : aucun.

