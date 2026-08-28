import React, { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topnav } from "./topnav";
import { OverdueOrdersAlert } from "@/components/OverdueOrdersAlert";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeSync } from "@/hooks/useRealTimeSync";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // WebSocket global : actif sur toutes les pages de l'app
  useRealTimeSync(user?.id);

  return (
    <div className="min-h-screen flex bg-[#f5f6f8]">
      {/* Sidebar */}
      <Sidebar
        className="hidden md:flex"
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <Topnav onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 pl-6 pr-6 pt-6 pb-6">
          {children}
        </main>
      </div>

      {/* Modal d'alerte pour les commandes en retard - s'affiche automatiquement à la connexion */}
      {user && <OverdueOrdersAlert userRole={user.role} />}
    </div>
  );
};

export default AppLayout;