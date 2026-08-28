import React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

interface AlertBannerCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  description?: string;
  count?: number;
  href?: string;
  variant?: "warning" | "danger" | "info";
}

const variantStyles = {
  warning: {
    card: "border-amber-200 bg-amber-50/60",
    icon: "bg-amber-100 text-amber-600",
    title: "text-amber-800",
    desc: "text-amber-600",
    link: "text-amber-700 hover:text-amber-900",
    count: "bg-amber-200 text-amber-800",
  },
  danger: {
    card: "border-red-200 bg-red-50/60",
    icon: "bg-red-100 text-red-600",
    title: "text-red-800",
    desc: "text-red-600",
    link: "text-red-700 hover:text-red-900",
    count: "bg-red-200 text-red-800",
  },
  info: {
    card: "border-blue-200 bg-blue-50/60",
    icon: "bg-blue-100 text-blue-600",
    title: "text-blue-800",
    desc: "text-blue-600",
    link: "text-blue-700 hover:text-blue-900",
    count: "bg-blue-200 text-blue-800",
  },
};

export function AlertBannerCard({
  icon,
  title,
  description,
  count,
  href,
  variant = "warning",
  className,
  ...props
}: AlertBannerCardProps) {
  const s = variantStyles[variant];

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-center gap-3",
        s.card,
        className
      )}
      {...props}
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", s.icon)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold leading-tight", s.title)}>{title}</p>
        {description && (
          <p className={cn("text-xs mt-0.5 truncate", s.desc)}>{description}</p>
        )}
      </div>
      {count !== undefined && (
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums shrink-0", s.count)}>
          {count}
        </span>
      )}
      {href && (
        <Link href={href}>
          <span className={cn("flex items-center gap-0.5 text-xs font-medium shrink-0 cursor-pointer", s.link)}>
            Voir <ArrowRight className="h-3 w-3" />
          </span>
        </Link>
      )}
    </div>
  );
}
