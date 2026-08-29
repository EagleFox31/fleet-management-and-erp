import React, { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topnav } from "./topnav";
import { OverdueOrdersAlert } from "@/components/OverdueOrdersAlert";
import { useAuth } from "@/hooks/useAuth";
import { useRealTimeSync } from "@/hooks/useRealTimeSync";
import { TechnicianBottomNav } from "./technician-bottom-nav";
import { PwaInstallBanner } from "@/components/pwa/pwa-install-banner";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // WebSocket global : actif sur toutes les pages de l'app
  useRealTimeSync(user?.id);

  const isTechnician = user?.role === "technician";

  return (
    <div className="min-h-screen flex bg-[#f5f6f8] dark:bg-slate-950">
      {/* Sidebar Desktop */}
      <Sidebar
        className="hidden md:flex"
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* Main content container */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topnav onMenuClick={() => setSidebarOpen(true)} />
        
        {/* Bannière d'installation PWA si sur mobile */}
        {isTechnician && (
          <div className="md:hidden pt-3 px-2">
            <PwaInstallBanner />
          </div>
        )}

        <main className={`flex-1 p-4 md:p-6 ${isTechnician ? "pb-24 md:pb-6" : ""}`}>
          {children}
        </main>
      </div>

      {/* Barre d'application mobile pour le Technicien (Bottom App Bar PWA) */}
      {isTechnician && <TechnicianBottomNav />}

      {/* Modal d'alerte pour les commandes en retard */}
      {user && <OverdueOrdersAlert userRole={user.role} />}
    </div>
  );
};

export default AppLayout;