import React from "react";

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export const PageLayout: React.FC<PageLayoutProps> = ({ children, className }) => {
  return (
    <div className={`space-y-6 ${className || ""}`}>
      {children}
    </div>
  );
};