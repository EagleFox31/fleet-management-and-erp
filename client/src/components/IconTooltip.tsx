import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ReactNode } from 'react';

interface IconTooltipProps {
  children: ReactNode;
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delayMs?: number;
}

export function IconTooltip({
  children,
  text,
  side = 'top',
  delayMs = 200,
}: IconTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={delayMs}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
