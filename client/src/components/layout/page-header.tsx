import React from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/PageHelp";

interface PageHelpConfig {
  title: string;
  description: string;
  tips?: string[];
  shortcuts?: { key: string; action: string }[];
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  backButton?: {
    label: string;
    href: string;
  };
  actions?: React.ReactNode;
  periodSelector?: {
    value: string;
    onChange: (value: string) => void;
    options: { label: string; value: string }[];
  };
  showExport?: boolean;
  onExport?: () => void;
  className?: string;
  help?: PageHelpConfig;
}

export function PageHeader({
  title,
  subtitle,
  description,
  backButton,
  actions,
  periodSelector,
  showExport = false,
  onExport,
  className,
  help,
}: PageHeaderProps) {
  const resolvedSubtitle = subtitle ?? description;

  return (
    <div className={cn("flex items-center justify-between mb-6", className)}>
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-2xl font-semibold font-sans text-foreground">{title}</h1>
          {resolvedSubtitle && <p className="text-sm text-muted-foreground mt-1">{resolvedSubtitle}</p>}
        </div>
        {help && (
          <PageHelp
            title={help.title}
            description={help.description}
            tips={help.tips}
            shortcuts={help.shortcuts}
          />
        )}
      </div>
      
      <div className="flex space-x-3">
        {backButton && (
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = backButton.href;
            }}
          >
            {backButton.label}
          </Button>
        )}
        {periodSelector && (
          <div className="relative">
            <Select
              value={periodSelector.value}
              onValueChange={periodSelector.onChange}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sélectionner une période" />
              </SelectTrigger>
              <SelectContent>
                {periodSelector.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {showExport && (
          <Button
            variant="outline"
            onClick={onExport}
            className="inline-flex items-center"
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
        )}
        
        {actions}
      </div>
    </div>
  );
}
