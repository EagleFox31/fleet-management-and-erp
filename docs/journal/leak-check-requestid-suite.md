# Contrôle de fuite : le requestId aléatoire fait échouer au hasard

- **Quoi** : `role-guards-pistes-def` et `vehicle-documents-upload-errors` contrôlaient une fuite (`/sql|syntax|NaN/i`, `/form|Multipart/i`) sur le corps entier d'une réponse d'erreur ; ils passent par `leakText`. Le garde-fou `leak-check-hygiene` reconnaît aussi `JSON.stringify(await res.json())` et `JSON.stringify(json)`.
- **Comment** : le motif du garde-fou ne visait que `…body` ; il couvre maintenant `await x.json()` et les variables nommées `json`.
- **Pourquoi** : le `requestId` est aléatoire (`nanoid(10)`) et contient parfois « sQl » (CI du 5 novembre 2026, contract 4, #405). Même cause que l'incident du 3 novembre, motif trop étroit. Balayage des autres `stringify` + regex des contrats : les autres sont des correspondances positives ou portent sur un `payload` sans `requestId`.
