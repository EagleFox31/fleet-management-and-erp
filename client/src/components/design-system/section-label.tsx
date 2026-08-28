import React from "react";
import { cn } from "@/lib/utils";

interface SectionLabelProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function SectionLabel({ className, children, ...props }: SectionLabelProps) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold uppercase tracking-widest text-gray-400",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
