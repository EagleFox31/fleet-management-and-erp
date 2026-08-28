# Fichiers (client + server) avec au moins 1000 lignes

_Généré le 2026-03-02_

_Exclusions: `backup`, `_archive`_

| Lignes | Fichier |
|---:|---|
| 5765 | `server/routes.ts` |
| 3073 | `client/src/pages/inventory/tires/index.tsx` |
| 2075 | `server/storage.ts` |
| 1769 | `client/src/pages/maintenance/work-orders/[id].tsx` |
| 1254 | `client/src/pages/reports/index.tsx` |
| 1244 | `client/src/pages/inventory/requests.tsx` |
| 1141 | `server/services/procurement-service.ts` |
| 1045 | `client/src/lib/pdf-export.ts` |

## Pages uniquement (client/src/pages)

| Lignes | Page |
|---:|---|
| 3073 | `client/src/pages/inventory/tires/index.tsx` |
| 1769 | `client/src/pages/maintenance/work-orders/[id].tsx` |
| 1254 | `client/src/pages/reports/index.tsx` |
| 1244 | `client/src/pages/inventory/requests.tsx` |

## Commande utilisée

```bash
find client server -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/backup/*' ! -path '*/_archive/*' | xargs wc -l | awk '$1 >= 1000 && $2 != "total" {print $1"\t"$2}' | sort -nr
```
