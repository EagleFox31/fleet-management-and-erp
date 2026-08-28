import React from "react";
import { cn } from "@/lib/utils";

type KpiGridColumns = 2 | 3 | 4 | 6;

const COLUMNS_CLASS: Record<KpiGridColumns, string> = {
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
  6: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

interface KpiGridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: KpiGridColumns;
  withTopBorder?: boolean;
}

export function KpiGrid({
  columns = 4,
  withTopBorder = true,
  className,
  children,
  ...props
}: KpiGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3",
        COLUMNS_CLASS[columns],
        withTopBorder && "mt-5 pt-5 border-t border-gray-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
