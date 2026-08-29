import React from "react";
import { cn } from "@/lib/utils";

type IconSquareSize = "sm" | "lg";
export type IconSquareTone = "green" | "blue" | "amber" | "red" | "gray";

const SIZE_CLASS: Record<IconSquareSize, string> = {
  sm: "h-7 w-7 rounded-lg",
  lg: "h-10 w-10 rounded-xl border",
};

const TONE_CLASS: Record<IconSquareTone, string> = {
  green: "bg-green-50 border-green-100 text-green-600",
  blue: "bg-blue-50 border-blue-100 text-blue-600",
  amber: "bg-amber-50 border-amber-100 text-amber-600",
  red: "bg-red-50 border-red-100 text-red-600",
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
