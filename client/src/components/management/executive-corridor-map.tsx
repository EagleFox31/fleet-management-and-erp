import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Filter,
  RefreshCw,
  Route,
  Search,
  Truck,
  X,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { CardShell } from "@/components/design-system";
import {
  CEMAC_CORRIDORS,
  LOGISTICS_HUBS,
  type LiveCorridorVehicle,
  type TransitStatus,
} from "@shared/constants/cemac-corridors";

type ExecutiveCorridorMapProps = {
  fleet: LiveCorridorVehicle[];
  isLoading?: boolean;
};

// Icône personnalisée de camion avec pastille radar pulsante
function createTruckDivIcon(status: TransitStatus, registrationNumber: string) {
  const statusColors = {
    in_transit: {
      bg: "#10b981", // Émeraude
      ring: "rgba(16, 185, 129, 0.4)",
      border: "#059669",
    },
    returning: {
      bg: "#06b6d4", // Cyan
      ring: "rgba(6, 182, 212, 0.4)",
      border: "#0891b2",
    },
    loading: {
      bg: "#f59e0b", // Ambre
      ring: "rgba(245, 158, 11, 0.4)",
      border: "#d97706",
    },
    stopped: {
      bg: "#64748b", // Slate
      ring: "rgba(100, 116, 139, 0.3)",
      border: "#475569",
    },
    alert: {
      bg: "#ef4444", // Rouge
      ring: "rgba(239, 68, 68, 0.5)",
      border: "#dc2626",
    },
  }[status];

  const html = `
    <div class="relative flex items-center justify-center group cursor-pointer" style="width:28px;height:28px;">
      <div class="absolute -inset-1 rounded-full animate-ping opacity-75" style="background-color: ${statusColors.ring};"></div>
      <div class="relative flex items-center justify-center w-7 h-7 rounded-full shadow-lg text-white font-bold text-[10px] border-2 transition-transform duration-300 group-hover:scale-125" style="background-color: ${statusColors.bg}; border-color: ${statusColors.border};">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
          <path d="M15 18H9"/>
          <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
          <circle cx="17" cy="18" r="2"/>
          <circle cx="7" cy="18" r="2"/>
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-truck-pin",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

export function ExecutiveCorridorMap({ fleet, isLoading }: ExecutiveCorridorMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const [selectedCorridor, setSelectedCorridor] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<LiveCorridorVehicle | null>(null);

  // Filtrage de la flotte
  const filteredFleet = useMemo(() => {
    return (fleet || []).filter((v) => {
      if (selectedCorridor !== "all" && v.corridorId !== selectedCorridor) return false;
      if (selectedStatus !== "all" && v.transitStatus !== selectedStatus) return false;
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const matchReg = v.registrationNumber.toLowerCase().includes(q);
        const matchDriver = v.driverName?.toLowerCase().includes(q);
        const matchClient = v.clientName?.toLowerCase().includes(q);
        const matchDest = v.destination.toLowerCase().includes(q);
        if (!matchReg && !matchDriver && !matchClient && !matchDest) return false;
      }
      return true;
    });
  }, [fleet, selectedCorridor, selectedStatus, searchQuery]);

  // Statistiques rapides
  const stats = useMemo(() => {
    const total = fleet.length;
    const inTransit = fleet.filter((v) => v.transitStatus === "in_transit").length;
    const returning = fleet.filter((v) => v.transitStatus === "returning").length;
    const loading = fleet.filter((v) => v.transitStatus === "loading" || v.transitStatus === "stopped").length;
    const alert = fleet.filter((v) => v.transitStatus === "alert").length;
    return { total, inTransit, returning, loading, alert };
  }, [fleet]);

  // Initialisation de la carte Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [7.3697, 12.3547], // Centre Cameroun
      zoom: 6,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 18,
      subdomains: "abcd",
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Rendu des couches (corridors, hubs, camions) à chaque changement
  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    const map = mapInstanceRef.current;
    if (!layerGroup || !map) return;

    layerGroup.clearLayers();

    // 1. Tracé des Corridors CEMAC
    Object.values(CEMAC_CORRIDORS).forEach((corridor) => {
      const isSelected = selectedCorridor === "all" || selectedCorridor === corridor.id;
      const polyline = L.polyline(corridor.polyline, {
        color: corridor.color,
        weight: selectedCorridor === corridor.id ? 5 : 3.5,
        opacity: isSelected ? 0.85 : 0.2,
        dashArray: selectedCorridor === corridor.id ? undefined : "6, 8",
      });
      polyline.addTo(layerGroup);
    });

    // 2. Hubs logistiques (Villes)
    Object.values(LOGISTICS_HUBS).forEach((hub) => {
      const isKeyHub = hub.role === "capital" || hub.role === "port";
      const marker = L.circleMarker(hub.coordinates, {
        radius: isKeyHub ? 5 : 3.5,
        color: "#94a3b8",
        fillColor: "#0f172a",
        fillOpacity: 0.9,
        weight: 1.5,
      });

      marker.bindPopup(`
        <div style="font-family: sans-serif; padding: 2px;">
          <div style="font-weight: bold; font-size: 12px; color: #0f172a;">${hub.name}</div>
          <div style="font-size: 11px; color: #64748b;">${hub.description}</div>
        </div>
      `);
      marker.addTo(layerGroup);
    });

    // 3. Camions filtrés
    filteredFleet.forEach((vehicle) => {
      const icon = createTruckDivIcon(vehicle.transitStatus, vehicle.registrationNumber);
      const marker = L.marker([vehicle.currentLat, vehicle.currentLng], { icon });

      marker.on("click", () => {
        setSelectedVehicle(vehicle);
      });

      const popupContent = `
        <div style="font-family: sans-serif; min-width: 210px; padding: 4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:4px; margin-bottom:6px;">
            <strong style="color:#059669; font-size:12px;">${vehicle.registrationNumber}</strong>
            <span style="background:#f1f5f9; color:#475569; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:600;">
              ${vehicle.brand} ${vehicle.model}
            </span>
          </div>
          <div style="font-size:11px; color:#334155; line-height:1.5;">
            <div><strong>Chauffeur:</strong> ${vehicle.driverName || "Non assigné"}</div>
            ${vehicle.clientName ? `<div><strong>Client:</strong> ${vehicle.clientName}</div>` : ""}
            <div><strong>Trajet:</strong> ${vehicle.origin} → <span style="color:#047857; font-weight:bold;">${vehicle.destination}</span></div>
            ${vehicle.cargoLabel ? `<div><strong>Fret:</strong> ${vehicle.cargoLabel}</div>` : ""}
            <div style="margin-top:4px; padding-top:4px; border-top:1px solid #f1f5f9; font-weight:bold; color:#0f172a;">
              Conso: ${vehicle.fuelConsumptionAvg} L/100 km
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(layerGroup);
    });
  }, [filteredFleet, selectedCorridor]);

  const handleResetView = () => {
    setSelectedVehicle(null);
    setSelectedCorridor("all");
    setSelectedStatus("all");
    setSearchQuery("");
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([7.3697, 12.3547], 6, { animate: true });
    }
  };

  return (
    <CardShell className="overflow-hidden border border-slate-200/80 dark:border-slate-800 shadow-md">
      {/* En-tête Executive */}
      <div className="p-4 bg-slate-900 text-white border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-white">
                  Cartographie des Corridors CEMAC &amp; Flotte en Direct
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  Live
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Suivi macro en temps réel des axes Douala, Yaoundé, Garoua, Maroua, N&apos;Djamena &amp; Bangui
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetView}
              className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Vue Globale
            </button>
          </div>
        </div>

        {/* Barre de compteurs de statut */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSelectedStatus("all")}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              selectedStatus === "all"
                ? "bg-slate-800 border-slate-600 text-white"
                : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <div className="text-[10px] font-medium text-slate-400">Total Flotte</div>
            <div className="text-base font-bold text-white">{stats.total} camions</div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatus("in_transit")}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              selectedStatus === "in_transit"
                ? "bg-emerald-950/80 border-emerald-500 text-emerald-300"
                : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <div className="text-[10px] font-medium text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              En Transit Fret
            </div>
            <div className="text-base font-bold text-emerald-400">{stats.inTransit}</div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatus("returning")}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              selectedStatus === "returning"
                ? "bg-cyan-950/80 border-cyan-500 text-cyan-300"
                : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <div className="text-[10px] font-medium text-cyan-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              En Rotation Retour
            </div>
            <div className="text-base font-bold text-cyan-400">{stats.returning}</div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatus("loading")}
            className={`p-2 rounded-lg border text-left transition cursor-pointer ${
              selectedStatus === "loading"
                ? "bg-amber-950/80 border-amber-500 text-amber-300"
                : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <div className="text-[10px] font-medium text-amber-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              À Quai / Dépôt
            </div>
            <div className="text-base font-bold text-amber-400">{stats.loading}</div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatus("alert")}
            className={`p-2 rounded-lg border text-left transition col-span-2 sm:col-span-1 cursor-pointer ${
              selectedStatus === "alert"
                ? "bg-rose-950/80 border-rose-500 text-rose-300"
                : "bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/50"
            }`}
          >
            <div className="text-[10px] font-medium text-rose-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Immobilisé / Panne
            </div>
            <div className="text-base font-bold text-rose-400">{stats.alert}</div>
          </button>
        </div>

        {/* Filtres par corridor & Recherche */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> Corridors :
            </span>
            <button
              type="button"
              onClick={() => setSelectedCorridor("all")}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                selectedCorridor === "all"
                  ? "bg-primary text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Tous
            </button>
            {Object.values(CEMAC_CORRIDORS).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCorridor(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                  selectedCorridor === c.id
                    ? "bg-slate-700 text-white border border-slate-500 font-semibold"
                    : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name.split("(")[0].trim()}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Chercher camion, chauffeur, ville..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs bg-slate-950/80 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Zone Cartographique Leaflet Container */}
      <div className="relative h-[480px] w-full bg-slate-950">
        <div ref={mapContainerRef} className="h-full w-full" />

        {/* Panneau d'inspection du véhicule sélectionné (Flottant à droite) */}
        {selectedVehicle && (
          <div className="absolute top-3 right-3 z-[1000] w-72 bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white rounded-xl shadow-2xl p-4 space-y-3 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-sm text-white">
                  {selectedVehicle.registrationNumber}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVehicle(null)}
                className="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">Trajet Corridor</span>
                <span className="font-semibold text-white flex items-center gap-1.5 mt-0.5">
                  {selectedVehicle.origin} <ChevronRight className="h-3 w-3 text-emerald-400 shrink-0" /> {selectedVehicle.destination}
                </span>
              </div>

              {/* Barre de progression du trajet */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Progression mission</span>
                  <span className="font-bold text-emerald-400">{selectedVehicle.progressPercent}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${selectedVehicle.progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Chauffeur</span>
                  <span className="font-medium text-white">{selectedVehicle.driverName || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Client</span>
                  <span className="font-medium text-white">{selectedVehicle.clientName || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Fret</span>
                  <span className="font-medium text-white truncate block">{selectedVehicle.cargoLabel || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Conso Moy.</span>
                  <span className="font-bold text-emerald-400">{selectedVehicle.fuelConsumptionAvg} L/100km</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </CardShell>
  );
}
