import React from "react";
import { cn } from "@/lib/utils";

interface ReferenceChipProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ReferenceChip({ className, children, ...props }: ReferenceChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-gray-600",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
