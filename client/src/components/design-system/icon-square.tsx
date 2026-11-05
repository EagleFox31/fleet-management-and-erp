import React from "react";
import { cn } from "@/lib/utils";

type IconSquareSize = "sm" | "lg";
export type IconSquareTone = "green" | "blue" | "amber" | "red" | "gray";

const SIZE_CLASS: Record<IconSquareSize, string> = {
  sm: "h-7 w-7 rounded-lg",
  lg: "h-10 w-10 rounded-xl border",
};

const TONE_CLASS: Record<IconSquareTone, string> = {
  green: "bg-primary/10 border-primary/20 text-primary-text",
  blue: "bg-blue-50 border-blue-100 text-blue-600",
  amber: "bg-warning/10 border-warning/30 text-warning-text",
  red: "bg-destructive/10 border-destructive/20 text-destructive-text",
  gray: "bg-gray-100 border-gray-200 text-gray-600",
};

interface IconSquareProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: IconSquareSize;
  tone?: IconSquareTone;
}

export function IconSquare({
  size = "sm",
  tone = "green",
  className,
  children,
  ...props
}: IconSquareProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
