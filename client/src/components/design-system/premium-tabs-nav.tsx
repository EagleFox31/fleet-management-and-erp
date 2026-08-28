import React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface PremiumTabsNavItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  helpTarget?: string;
  testId?: string;
}

interface PremiumTabsNavProps {
  tabs: PremiumTabsNavItem[];
  className?: string;
  helpTarget?: string;
}

export function PremiumTabsNav({ tabs, className, helpTarget }: PremiumTabsNavProps) {
  return (
    <TabsList
      data-help-target={helpTarget}
      className={cn(
        "mb-5 bg-gray-100/90 p-1.5 rounded-2xl h-auto gap-1",
        "shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] border border-black/[0.04]",
        className
      )}
    >
      {tabs.map(({ value, label, icon, helpTarget, testId }) => (
        <TabsTrigger
          key={value}
          value={value}
          data-help-target={helpTarget}
          data-testid={testId}
          className="rounded-xl text-sm px-4 py-2 font-medium text-gray-500 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.06)] transition-all"
        >
          <span className="inline-flex items-center gap-2">
            {icon ? (
              <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">
                {icon}
              </span>
            ) : null}
            <span>{label}</span>
          </span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
