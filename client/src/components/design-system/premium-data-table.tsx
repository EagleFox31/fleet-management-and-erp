import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PremiumTableShell } from "@/components/design-system/premium-table-shell";

type TableAlign = "left" | "center" | "right";
export type SortDirection = "asc" | "desc";

const ALIGN_CLASS: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

type RowClassNameResolver<T> =
  | string
  | ((row: T, rowIndex: number) => string | undefined);

type CellClassNameResolver<T> =
  | string
  | ((row: T, rowIndex: number) => string | undefined);

export interface PremiumDataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, rowIndex: number) => React.ReactNode;
  align?: TableAlign;
  widthClassName?: string;
  headerClassName?: string;
  cellClassName?: CellClassNameResolver<T>;
  sortable?: boolean;
}

export interface PremiumDataTableProps<T>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  columns: PremiumDataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, rowIndex: number) => React.Key;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
  tableClassName?: string;
  tbodyClassName?: string;
  rowClassName?: RowClassNameResolver<T>;
  onRowClick?: (row: T, rowIndex: number) => void;
  toolbarClassName?: string;
  footerClassName?: string;
  tableContainerClassName?: string;
  sortColumn?: string | null;
  sortDirection?: SortDirection;
  onSortChange?: (columnId: string) => void;
  excelHeader?: boolean;
}

function resolveRowClassName<T>(
  resolver: RowClassNameResolver<T> | undefined,
  row: T,
  rowIndex: number,
) {
  if (!resolver) return undefined;
  return typeof resolver === "function" ? resolver(row, rowIndex) : resolver;
}

function resolveCellClassName<T>(
  resolver: CellClassNameResolver<T> | undefined,
  row: T,
  rowIndex: number,
) {
  if (!resolver) return undefined;
  return typeof resolver === "function" ? resolver(row, rowIndex) : resolver;
}

export function PremiumDataTable<T>({
  columns,
  rows,
  rowKey,
  toolbar,
  footer,
  emptyState,
  className,
  tableClassName,
  tbodyClassName,
  rowClassName,
  onRowClick,
  toolbarClassName,
  footerClassName,
  tableContainerClassName,
  sortColumn = null,
  sortDirection = "asc",
  onSortChange,
  excelHeader = false,
  ...props
}: PremiumDataTableProps<T>) {
  const renderSortIcon = (columnId: string, sortable?: boolean) => {
    if (!sortable || !onSortChange) return null;
    if (sortColumn !== columnId) {
      return <ArrowUpDown className="h-3 w-3 shrink-0 text-gray-400 opacity-60" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 shrink-0 text-primary-text" />
    ) : (
      <ArrowDown className="h-3 w-3 shrink-0 text-primary-text" />
    );
  };

  return (
    <PremiumTableShell
      className={className}
      toolbar={toolbar}
      footer={footer}
      toolbarClassName={toolbarClassName}
      footerClassName={footerClassName}
      tableContainerClassName={tableContainerClassName}
      {...props}
    >
      {rows.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-gray-400">
          {emptyState || "Aucune donnee disponible."}
        </div>
      ) : (
        <table className={cn("w-full text-sm border-collapse", tableClassName)}>
          <thead className="sticky top-0 z-10">
            <tr className={cn(
              excelHeader ? "bg-[#eceff1]" : "bg-gray-50 border-b border-gray-100",
            )}>
              {columns.map((column, columnIndex) => {
                const align = column.align || "left";
                const isSortable = Boolean(column.sortable && onSortChange);
                const isLast = columnIndex === columns.length - 1;

                return (
                  <th
                    key={column.id}
                    className={cn(
                      excelHeader
                        ? "border-b border-r border-gray-300 px-2 py-1.5 text-[11px] font-semibold text-gray-700"
                        : "px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400",
                      !isLast && excelHeader && "border-r border-gray-300",
                      !excelHeader && "border-b border-gray-100",
                      ALIGN_CLASS[align],
                      column.widthClassName,
                      column.headerClassName,
                    )}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange?.(column.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 w-full select-none transition-colors",
                          align === "right" && "justify-end",
                          align === "center" && "justify-center",
                          excelHeader
                            ? "hover:bg-gray-200/70 rounded px-1 py-0.5"
                            : "hover:text-gray-600",
                        )}
                      >
                        <span>{column.header}</span>
                        {renderSortIcon(column.id, column.sortable)}
                      </button>
                    ) : (
                      <span className={cn(
                        "inline-flex items-center gap-1.5",
                        align === "right" && "justify-end w-full",
                      )}>
                        {column.header}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={tbodyClassName}>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowKey(row, rowIndex)}
                className={cn(
                  excelHeader
                    ? "border-b border-gray-200 hover:bg-blue-50/40"
                    : "border-b border-gray-50 last:border-0 hover:bg-gray-50/60",
                  "transition-colors",
                  onRowClick ? "cursor-pointer" : undefined,
                  resolveRowClassName(rowClassName, row, rowIndex),
                )}
                onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
              >
                {columns.map((column, columnIndex) => {
                  const align = column.align || "left";
                  const isLast = columnIndex === columns.length - 1;
                  return (
                    <td
                      key={`${String(rowKey(row, rowIndex))}-${column.id}`}
                      className={cn(
                        excelHeader
                          ? "border-r border-gray-200 px-2 py-2 align-middle text-gray-800 text-[13px]"
                          : "px-4 py-3.5 align-middle text-gray-700",
                        !isLast && excelHeader && "border-r border-gray-200",
                        ALIGN_CLASS[align],
                        column.widthClassName,
                        resolveCellClassName(column.cellClassName, row, rowIndex),
                      )}
                    >
                      {column.cell(row, rowIndex)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PremiumTableShell>
  );
}
