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
    <div className="w-full max-w-full overflow-x-auto scrollbar-none -mx-1 px-1 mb-5">
      <TabsList
        data-help-target={helpTarget}
        className={cn(
          "inline-flex w-auto min-w-full sm:min-w-0 bg-gray-100/90 dark:bg-slate-800/90 p-1.5 rounded-2xl h-auto gap-1",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] border border-black/[0.04] dark:border-white/[0.06] shrink-0",
          className
        )}
      >
        {tabs.map(({ value, label, icon, helpTarget, testId }) => (
          <TabsTrigger
            key={value}
            value={value}
            data-help-target={helpTarget}
            data-testid={testId}
            className="rounded-xl text-xs sm:text-sm px-3 sm:px-4 py-2 font-medium text-gray-500 dark:text-slate-400 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:text-gray-900 dark:data-[state=active]:text-white data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.06)] transition-all shrink-0"
          >
            <span className="inline-flex items-center gap-1.5 sm:gap-2">
              {icon ? (
                <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5 sm:[&>svg]:h-4 sm:[&>svg]:w-4">
                  {icon}
                </span>
              ) : null}
              <span className="whitespace-nowrap">{label}</span>
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
