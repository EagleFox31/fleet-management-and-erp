import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface DataTableColumn<T = any> {
  header: string;
  accessorKey: keyof T | string;
  cell?: (value: any, row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T = any> {
  data: T[];
  columns: DataTableColumn<T>[];
  searchPlaceholder?: string;
  className?: string;
  tableContainerClassName?: string;
  stickyHeader?: boolean;
  zebra?: boolean;
  coloredHeader?: boolean;
  filterOptions?: {
    name: string;
    options: { label: string; value: string }[];
    value: string;
    onChange: (value: string) => void;
  }[];
  pagination?: {
    totalItems: number;
    itemsPerPage: number;
    currentPage: number;
    onPageChange: (page: number) => void;
  };
  onSearch?: (value: string) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  isLoading?: boolean;
}

export function DataTable<T = any>({
  data,
  columns,
  searchPlaceholder = "Rechercher...",
  className,
  tableContainerClassName,
  stickyHeader = false,
  zebra = false,
  coloredHeader = false,
  filterOptions,
  pagination,
  onSearch,
  onRowClick,
  rowClassName,
  isLoading = false,
}: DataTableProps<T>) {
  const [searchValue, setSearchValue] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    key: string | null;
    direction: "asc" | "desc";
  }>({ key: null, direction: "asc" });

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    if (onSearch) {
      onSearch(value);
    }
  };

  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable) return;

    const columnKey = String(column.accessorKey);
    let direction: "asc" | "desc" = "asc";
    if (sortConfig.key === columnKey) {
      direction = sortConfig.direction === "asc" ? "desc" : "asc";
    }
    setSortConfig({ key: columnKey, direction });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-4 items-center">
        {onSearch && (
          <div className="relative flex-grow max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <i className="fas fa-search text-muted-foreground"></i>
            </div>
            <Input
              type="text"
              className="pl-10"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={handleSearch}
            />
          </div>
        )}

        {filterOptions && filterOptions.map((filter, index) => (
          <div className="relative" key={index}>
            <Select
              value={filter.value || '__all__'}
              onValueChange={(val) => filter.onChange(val === '__all__' ? '' : val)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={filter.name} />
              </SelectTrigger>
              <SelectContent>
                {filter.options.map((option) => (
                  <SelectItem 
                    key={option.value || '__all__'} 
                    value={option.value || '__all__'}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className={cn("rounded-md border relative", tableContainerClassName)}>
        <Table>
          <TableHeader>
            <TableRow
              className={cn(
                coloredHeader && "border-b border-slate-900 bg-black",
              )}
            >
              {columns.map((column, index) => (
                <TableHead
                  key={index}
                  className={cn(
                    column.className,
                    column.sortable && "cursor-pointer",
                    stickyHeader &&
                      (coloredHeader
                        ? "sticky top-0 z-20 bg-black shadow-sm"
                        : "sticky top-0 z-20 bg-background shadow-sm"),
                    coloredHeader && "bg-black font-semibold text-white",
                  )}
                  onClick={() => column.sortable && handleSort(column)}
                >
                  <div className="flex items-center">
                    {column.header}
                    {column.sortable && sortConfig.key === String(column.accessorKey) && (
                      <i className={`fas fa-sort-${sortConfig.direction === "asc" ? "down" : "up"} ml-1 text-primary`}></i>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-row-${rowIndex}`}>
                  {columns.map((_, colIndex) => (
                    <TableCell key={`skeleton-cell-${rowIndex}-${colIndex}`}>
                      <Skeleton className="h-5 w-full max-w-[180px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Aucun résultat trouvé
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  className={cn(
                    zebra && rowIndex % 2 !== 0 ? "bg-green-50/60 dark:bg-green-900/10" : "",
                    onRowClick ? "cursor-pointer hover:bg-blue-50/60 dark:hover:bg-slate-700/50" : "",
                    rowClassName ? rowClassName(row) : ""
                  )}
                  onClick={() => onRowClick && onRowClick(row)}
                >
                  {columns.map((column, colIndex) => {
                    const accessorKey = column.accessorKey as string;
                    const rowRecord = row as Record<string, any>;
                    return (
                    <TableCell key={colIndex} className={column.className}>
                      {column.cell
                        ? column.cell(rowRecord[accessorKey], row)
                        : rowRecord[accessorKey] as React.ReactNode}
                    </TableCell>
                  )})}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between space-x-2 py-4">
          {isLoading ? (
            <>
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-8 w-36" />
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                {pagination.totalItems > 0 ? (
                  <>
                    Affichage de {((pagination.currentPage - 1) * pagination.itemsPerPage) + 1} à{" "}
                    {Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)} sur{" "}
                    {pagination.totalItems} éléments
                  </>
                ) : (
                  "Aucun élément à afficher"
                )}
              </div>
              {pagination.totalItems > pagination.itemsPerPage && (
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                    disabled={pagination.currentPage <= 1}
                  >
                    Précédent
                  </Button>
                  <span className="text-sm">
                    Page {pagination.currentPage} sur {Math.ceil(pagination.totalItems / pagination.itemsPerPage)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                    disabled={pagination.currentPage >= Math.ceil(pagination.totalItems / pagination.itemsPerPage)}
                  >
                    Suivant
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
