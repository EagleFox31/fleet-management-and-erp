import React from "react";
import { cn } from "@/lib/utils";

interface PremiumTableShellProps extends React.HTMLAttributes<HTMLDivElement> {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  toolbarClassName?: string;
  footerClassName?: string;
  tableContainerClassName?: string;
}

export function PremiumTableShell({
  className,
  toolbar,
  footer,
  children,
  toolbarClassName,
  footerClassName,
  tableContainerClassName,
  ...props
}: PremiumTableShellProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden",
        className,
      )}
      {...props}
    >
      {toolbar ? (
        <div className={cn("px-5 py-3.5 border-b border-gray-100 flex items-center gap-3", toolbarClassName)}>
          {toolbar}
        </div>
      ) : null}
      <div className={cn("overflow-x-auto overflow-y-auto max-h-[560px]", tableContainerClassName)}>{children}</div>
      {footer ? (
        <div
          className={cn(
            "border-t border-gray-100 px-5 py-3 flex items-center justify-between",
            footerClassName,
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
