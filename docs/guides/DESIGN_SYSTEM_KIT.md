# Kit Design System

Kit cree dans `client/src/components/design-system`.

## Composants

- `CardShell`: wrapper carte premium avec option barre verte
- `HeaderCard`: en-tete standard module + actions + zone KPI
- `KpiTile`: tuile KPI standard
- `KpiGrid`: grille KPI (2/3/4 colonnes)
- `PremiumTableShell`: shell standard toolbar + table + footer
- `PremiumDataTable`: table metier generique (colonnes typees, etat vide, clic ligne)
- `IconSquare`: conteneur icone `sm` / `lg`
- `SectionLabel`: label de section en uppercase
- `ReferenceChip`: badge reference mono
- `StatusBadge`: badge statut + utilitaire `getStatusBadgeClass`
- `UrgencyBadge`: badge urgence + utilitaires `getUrgencyBadgeClass` et `getUrgencyBorderClass`

## Export central

Importer via:

```ts
import { HeaderCard, KpiTile, StatusBadge } from "@/components/design-system";
```

## Exemple rapide table

```tsx
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";

const columns: PremiumDataTableColumn<MyRow>[] = [
  { id: "name", header: "Nom", cell: (row) => row.name },
  { id: "status", header: "Statut", cell: (row) => row.status, align: "center" },
];

<PremiumDataTable
  columns={columns}
  rows={data}
  rowKey={(row) => row.id}
  toolbar={<div>Filtres</div>}
  emptyState="Aucune ligne."
/>;
```
