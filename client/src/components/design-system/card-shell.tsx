import React from "react";
import { cn } from "@/lib/utils";

interface CardShellProps extends React.HTMLAttributes<HTMLDivElement> {
  topBar?: boolean;
  topBarClassName?: string;
}

export function CardShell({
  className,
  topBar = false,
  topBarClassName,
  children,
  ...props
}: CardShellProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden",
        className,
      )}
      {...props}
    >
      {topBar && (
        <div
          className={cn(
            "h-0.5 bg-gradient-to-r from-green-500 to-emerald-400",
            topBarClassName,
          )}
        />
      )}
      {children}
    </div>
  );
}
