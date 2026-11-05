import React from "react";
import { cn } from "@/lib/utils";
import { CardShell } from "@/components/design-system/card-shell";
import { IconSquare } from "@/components/design-system/icon-square";
import { SectionLabel } from "@/components/design-system/section-label";

interface HeaderCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  moduleLabel?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  bodyClassName?: string;
}

export function HeaderCard({
  moduleLabel,
  title,
  subtitle,
  icon,
  actions,
  className,
  bodyClassName,
  children,
  ...props
}: HeaderCardProps) {
  return (
    <CardShell className={className} topBar {...props}>
      <div className={cn("px-6 py-5", bodyClassName)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon ? <IconSquare size="lg">{icon}</IconSquare> : null}
            <div className="min-w-0">
              {moduleLabel ? <SectionLabel className="text-primary-text">{moduleLabel}</SectionLabel> : null}
              <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
              {subtitle ? <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </CardShell>
  );
}
