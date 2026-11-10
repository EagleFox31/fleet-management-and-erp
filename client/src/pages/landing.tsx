import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Shield, 
  Wrench, 
  Briefcase, 
  FileText, 
  Truck, 
  Package, 
  Users, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  TrendingUp, 
  AlertTriangle, 
  BarChart3, 
  Settings, 
  Clock, 
  DollarSign,
  Activity,
  Radio,
  Sparkles,
  ShieldCheck,
  Info,
  ChevronRight,
  Minus,
  KeyRound,
  Lightbulb,
  PlayCircle,
  Calculator
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect, useRef, type ElementType } from "react";
import { motion, useScroll, useSpring } from "framer-motion";

// Composant CountUp pour animer les chiffres
function CountUp({ end, duration = 2000, suffix = "", className = "text-3xl font-bold text-white" }: { end: number; duration?: number; suffix?: string; className?: string }) {
  const [count, setCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let startTime: number | null = null;
    const startValue = 0;
    let animationFrameId: number | null = null;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(easeOutQuart * (end - startValue) + startValue));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    // Cleanup : annuler l'animation frame si le composant se démonte
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isVisible, end, duration]);

  return <div ref={ref} className={className}>{count}{suffix}</div>;
}

// Composant background avec vidéo et effet parallax sur l'overlay
function VideoBackground({ opacity = 0.85 }: { opacity?: number }) {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Effet parallax sur l'overlay
  const parallaxOffset = scrollY * 0.3;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-slate-900">
      {/* Vidéo de fond */}
      <video 
        autoPlay
        loop
        muted
        playsInline
        className="absolute min-h-full min-w-full object-cover opacity-70"
        aria-hidden="true"
      >
        <source src="/fleet-video.mp4" type="video/mp4" />
      </video>
      {/* Overlay gradient avec effet parallax - opacité réduite pour mieux voir la vidéo */}
      <div 
        className="absolute inset-0 bg-gradient-to-br from-green-900/50 via-slate-900/60 to-green-800/50 transition-transform duration-100 ease-out"
        style={{
          transform: `translateY(${parallaxOffset}px)`
        }}
      />
    </div>
  );
}

// Types de profils utilisateurs (10 profils métier)
/** Vidéo de démonstration par profil (client/public/demos), données de démonstration uniquement. */
const PROFILE_DEMO_VIDEOS: Partial<Record<string, string>> = {
  workshop_manager: "/demos/workshop_manager.mp4",
  technician: "/demos/technician.mp4",
  warehouse: "/demos/warehouse.mp4",
  logistics: "/demos/logistics.mp4",
  secretary: "/demos/secretary.mp4",
  management: "/demos/management.mp4",
  driver: "/demos/driver.mp4",
};

const userProfiles = [
  {
    id: "admin",
    name: "Administrateur",
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    description: "Contrôle total du système avec accès à toutes les fonctionnalités",
    permissions: ["Gestion complète", "Configuration", "Rapports", "Utilisateurs", "Sécurité", "Exports"],
  },
  {
    id: "workshop_manager",
    name: "Chef d'Atelier",
    icon: Wrench,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description: "Supervision des opérations de maintenance et gestion d'équipe",
    permissions: ["Ordres de travail", "Planification", "Équipe", "Rapports", "Pièces", "Validation"],
  },
  {
    id: "technician",
    name: "Technicien",
    icon: Settings,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    description: "Exécution des tâches de maintenance et interventions techniques",
    permissions: ["Mes ordres", "Interventions", "Historique", "Demandes pièces", "Inspections pneus"],
  },
  {
    id: "secretary",
    name: "Secrétaire",
    icon: FileText,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    description: "Gestion administrative, conformité documentaire et facturation",
    permissions: ["Documents flotte", "Factures fournisseurs", "Contrôle 3 voies", "Dossiers RH chauffeurs"],
  },
  {
    id: "logistics",
    name: "Logisticien",
    icon: Truck,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    description: "Coordination des missions, suivi carburant et gestion de flotte",
    permissions: ["Missions transport", "Consommation carburant", "Feuilles de route", "Affectations"],
  },
  {
    id: "warehouse",
    name: "Magasinier",
    icon: Package,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    description: "Gestion complète des stocks, pièces détachées et inventaire pneus",
    permissions: ["Inventaire pièces", "Réceptions / Entrées", "Sorties stock OT", "Catalogue pneus"],
  },
  {
    id: "management",
    name: "Direction (DG)",
    icon: Briefcase,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    description: "Dashboard exécutif, marge brute après charges, rentabilité et CA",
    permissions: ["CA facturé & encaissé", "Marge brute HT", "Top clients & lignes", "Rapport Direction PDF"],
  },
  {
    id: "accountant",
    name: "Comptable",
    icon: Calculator,
    color: "text-success",
    bgColor: "bg-success/10",
    description: "Règlements, trésorerie et suivi des encaissements",
    permissions: ["Factures fournisseurs", "Facturation client", "Trésorerie & traites", "Suivi carte carburant"],
  },
  {
    id: "client",
    name: "Client",
    icon: Users,
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    description: "Consultation exclusive de vos véhicules, missions et factures",
    permissions: ["Ses véhicules", "Ses missions", "Historique factures", "Export PDF"],
  },
  {
    id: "driver",
    name: "Chauffeur",
    icon: KeyRound,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    description: "Interface PWA mobile dédiée avec connexion rapide par code PIN",
    permissions: ["Mission du jour", "Feuille de route", "Relevé km départ/arrivée", "Alertes incident"],
  }
];

// Matrice des permissions granulaire par profil
const permissionsMatrix: Record<string, Record<string, boolean>> = {
  "Gestion véhicules & flotte": { admin: true, workshop_manager: true, technician: false, secretary: true, accountant: false, logistics: true, warehouse: false, management: true, client: false, driver: false },
  "Maintenance & Ordres de Travail": { admin: true, workshop_manager: true, technician: true, secretary: false, accountant: false, logistics: false, warehouse: false, management: true, client: false, driver: false },
  "Stock & Pièces détachées": { admin: true, workshop_manager: true, technician: true, secretary: true, accountant: false, logistics: false, warehouse: true, management: false, client: false, driver: false },
  "Pneumatiques (Stock & Montage)": { admin: true, workshop_manager: true, technician: true, secretary: false, accountant: false, logistics: false, warehouse: true, management: false, client: false, driver: false },
  "Commandes & Fournisseurs": { admin: true, workshop_manager: true, technician: false, secretary: true, accountant: true, logistics: true, warehouse: true, management: false, client: false, driver: false },
  "Facturation & Finances": { admin: true, workshop_manager: false, technician: false, secretary: true, accountant: true, logistics: false, warehouse: false, management: true, client: true, driver: false },
  "Missions & Carburant": { admin: true, workshop_manager: false, technician: false, secretary: true, accountant: true, logistics: true, warehouse: false, management: true, client: true, driver: true },
  "Rapports & Analytics": { admin: true, workshop_manager: true, technician: false, secretary: true, accountant: true, logistics: true, warehouse: true, management: true, client: false, driver: false },
  "Utilisateurs & Sécurité": { admin: true, workshop_manager: false, technician: false, secretary: false, accountant: false, logistics: false, warehouse: false, management: false, client: false, driver: false },
};

type FeatureStoryChapter = {
  id: string;
  step: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  metric: { value: string; label: string };
  icon: ElementType;
  accent: string;
  visual: "fleet" | "maintenance" | "procurement" | "billing" | "analytics" | "alerts";
};

const featureStoryChapters: FeatureStoryChapter[] = [
  {
    id: "fleet",
    step: "01",
    eyebrow: "Chapitre 1 — Visibilité",
    title: "Votre flotte, lisible en un coup d'œil",
    description:
      "Chaque véhicule a un statut clair, un historique complet et une traçabilité documentaire. Fini les tableurs éparpillés et les appels pour savoir qui roule.",
    bullets: [
      "Statuts synchronisés avec les ordres de travail actifs",
      "Documents et échéances centralisés par véhicule",
      "Kilométrage et conformité suivis en continu",
    ],
    metric: { value: "45+", label: "véhicules pilotés" },
    icon: Truck,
    accent: "from-emerald-500 to-teal-400",
    visual: "fleet",
  },
  {
    id: "maintenance",
    step: "02",
    eyebrow: "Chapitre 2 — Anticipation",
    title: "Anticipez les pannes avant qu'elles immobilisent",
    description:
      "Planifiez la maintenance préventive, assignez les techniciens et suivez chaque intervention jusqu'à la clôture. L'atelier gagne en cadence, la flotte reste disponible.",
    bullets: [
      "Ordres de travail assignés et priorisés",
      "Maintenance préventive déclenchée automatiquement",
      "Pièces réservées et consommées depuis l'OT",
    ],
    metric: { value: "100%", label: "maintenance planifiée" },
    icon: Wrench,
    accent: "from-blue-500 to-cyan-400",
    visual: "maintenance",
  },
  {
    id: "procurement",
    step: "03",
    eyebrow: "Chapitre 3 — Maîtrise des coûts",
    title: "Achetez mieux, contrôlez chaque facture",
    description:
      "Fournisseurs évalués, commandes groupées et contrôle à trois voies : bon de commande, réception, facture. Les écarts remontent avant le paiement.",
    bullets: [
      "Commandes groupées par fournisseur",
      "Matching automatique quantités et montants",
      "Notes fournisseurs par qualité, délais et prix",
    ],
    metric: { value: "3 voies", label: "de contrôle achats" },
    icon: Package,
    accent: "from-violet-500 to-purple-400",
    visual: "procurement",
  },
  {
    id: "billing",
    step: "04",
    eyebrow: "Chapitre 4 — Revenus",
    title: "De la mission à la facture, sans double saisie",
    description:
      "Les missions terminées alimentent la facturation client. TVA calculée, PDF généré, paiements suivis. La secrétaire et la logistique travaillent sur la même vérité.",
    bullets: [
      "Factures FACT-YYYYMMDD avec numérotation sécurisée",
      "TVA 19,25 % et suivi multi-étapes des paiements",
      "Export PDF et relances sur factures en retard",
    ],
    metric: { value: "19,25%", label: "TVA intégrée" },
    icon: DollarSign,
    accent: "from-amber-500 to-orange-400",
    visual: "billing",
  },
  {
    id: "analytics",
    step: "05",
    eyebrow: "Chapitre 5 — Décision",
    title: "Décidez avec des chiffres, pas des intuitions",
    description:
      "Tableaux de bord par rôle, KPI flotte et exports Excel en un clic. Chaque manager voit ce qui compte pour lui, du magasinier au directeur.",
    bullets: [
      "Dashboards adaptés à chaque profil utilisateur",
      "Exports inventaire, carburant et facturation",
      "Indicateurs opérationnels mis à jour en continu",
    ],
    metric: { value: "24/7", label: "suivi opérationnel" },
    icon: BarChart3,
    accent: "from-cyan-500 to-sky-400",
    visual: "analytics",
  },
  {
    id: "alerts",
    step: "06",
    eyebrow: "Chapitre 6 — Sérénité",
    title: "Soyez alerté avant que le problème coûte cher",
    description:
      "Documents expirés, stocks bas, retards fournisseurs, anomalies carburant : les alertes remontent au bon rôle, au bon moment, pour agir tôt.",
    bullets: [
      "Alertes maintenance et documents à échéance",
      "Seuils de stock et retards de livraison",
      "Notifications temps réel via WebSocket",
    ],
    metric: { value: "Proactif", label: "pas réactif" },
    icon: AlertTriangle,
    accent: "from-rose-500 to-pink-400",
    visual: "alerts",
  },
];

function FeatureStoryVisual({ type }: { type: FeatureStoryChapter["visual"] }) {
  const shell = "rounded-2xl border border-white/10 bg-slate-900/90 shadow-2xl shadow-black/40 overflow-hidden";

  if (type === "fleet") {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 bg-slate-800/80">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-2 text-xs text-slate-400">Flotte — Vue opérationnelle</span>
        </div>
        <div className="p-4 space-y-2">
          {[
            { plate: "LT-4821", status: "Opérationnel", tone: "bg-emerald-500/20 text-emerald-300" },
            { plate: "LT-9034", status: "Maintenance", tone: "bg-amber-500/20 text-amber-300" },
            { plate: "LT-1156", status: "Opérationnel", tone: "bg-emerald-500/20 text-emerald-300" },
          ].map((row) => (
            <div key={row.plate} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5">
              <span className="text-sm font-medium text-white">{row.plate}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${row.tone}`}>{row.status}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === "maintenance") {
    return (
      <div className={shell}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-300">OT #2847</span>
            <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs text-blue-200">En cours</span>
          </div>
          <p className="text-lg font-semibold text-white">Vidange + filtres — LT-9034</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-xs text-slate-400">Technicien</div>
              <div className="text-sm font-medium text-white">K. Moussa</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-xs text-slate-400">Priorité</div>
              <div className="text-sm font-medium text-amber-300">Haute</div>
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/10">
            <div className="h-2 w-2/3 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" />
          </div>
        </div>
      </div>
    );
  }

  if (type === "procurement") {
    return (
      <div className={shell}>
        <div className="p-5 space-y-3">
          <p className="text-sm font-semibold text-white">Contrôle 3 voies — Facture #FF-2026-041</p>
          {[
            { label: "Bon de commande", ok: true },
            { label: "Réception magasin", ok: true },
            { label: "Facture fournisseur", ok: false },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="text-sm text-slate-300">{row.label}</span>
              {row.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              )}
            </div>
          ))}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Écart détecté : +12 500 FCFA — validation requise
          </div>
        </div>
      </div>
    );
  }

  if (type === "billing") {
    return (
      <div className={shell}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="text-sm font-semibold text-white">FACT-20260817-003</span>
            <span className="text-xs text-emerald-300">Émise</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Mission MAERSK — Douala</span>
              <span className="text-white">850 000</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>TVA 19,25 %</span>
              <span className="text-white">163 625</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-white">
              <span>Total TTC</span>
              <span>1 013 625 FCFA</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "analytics") {
    return (
      <div className={shell}>
        <div className="p-5">
          <p className="mb-4 text-sm font-semibold text-white">KPI Flotte — Août</p>
          <div className="flex items-end gap-2 h-28">
            {[40, 65, 52, 78, 60, 88].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-gradient-to-t from-cyan-600 to-cyan-400"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-white/5 py-2">
              <div className="text-lg font-bold text-white">94%</div>
              <div className="text-xs text-slate-400">Disponibilité</div>
            </div>
            <div className="rounded-lg bg-white/5 py-2">
              <div className="text-lg font-bold text-white">12</div>
              <div className="text-xs text-slate-400">Fournisseurs</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="p-4 space-y-2">
        {[
          { label: "Visite technique LT-4821", tone: "text-rose-300" },
          { label: "Stock filtre huile < seuil", tone: "text-amber-300" },
          { label: "Facture fournisseur en retard", tone: "text-orange-300" },
        ].map((alert) => (
          <div key={alert.label} className="flex items-start gap-3 rounded-lg bg-white/5 px-3 py-2.5">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${alert.tone}`} />
            <span className="text-sm text-slate-200">{alert.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureStoryChapterRow({
  chapter,
  index,
}: {
  chapter: FeatureStoryChapter;
  index: number;
}) {
  const isReversed = index % 2 === 1;
  const Icon = chapter.icon;

  return (
    <motion.article
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center py-16 lg:py-24"
      data-testid={`story-chapter-${chapter.id}`}
    >
      <div className={`space-y-6 ${isReversed ? "lg:order-2" : "lg:order-1"}`}>
        <div className="flex items-center gap-4">
          <span className="text-5xl font-bold tabular-nums text-white/10">{chapter.step}</span>
          <div className={`h-px flex-1 bg-gradient-to-r ${chapter.accent} opacity-60`} />
        </div>

        <Badge variant="outline" className="border-white/15 bg-white/5 text-slate-300">
          {chapter.eyebrow}
        </Badge>

        <h3 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight">
          {chapter.title}
        </h3>

        <p className="text-lg text-slate-300 leading-relaxed max-w-xl">
          {chapter.description}
        </p>

        <ul className="space-y-3">
          {chapter.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-3 text-sm text-slate-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <div className="inline-flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${chapter.accent}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{chapter.metric.value}</div>
            <div className="text-xs uppercase tracking-wider text-slate-400">{chapter.metric.label}</div>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className={`relative ${isReversed ? "lg:order-1" : "lg:order-2"}`}
      >
        <div className={`absolute -inset-4 rounded-3xl bg-gradient-to-br ${chapter.accent} opacity-20 blur-2xl`} />
        <FeatureStoryVisual type={chapter.visual} />
      </motion.div>
    </motion.article>
  );
}

function FeatureStorySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative bg-slate-950/75 backdrop-blur-sm text-white border-t border-white/10"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />

      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center pt-20 pb-8"
        >
          <Badge className="mb-4 bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
            Parcours produit
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-4">
            De la route à la facture,{" "}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-200 bg-clip-text text-transparent">
              une histoire fluide
            </span>
          </h2>
          <p className="text-lg text-slate-400">
            Faites défiler pour découvrir comment Yaro FleetOS connecte chaque étape de vos opérations.
          </p>
        </motion.div>

        <div className="hidden lg:block absolute left-6 xl:left-12 top-48 bottom-32 w-px bg-white/10">
          <motion.div
            className="w-full origin-top bg-gradient-to-b from-emerald-400 to-teal-500"
            style={{ scaleY: progress, height: "100%" }}
          />
        </div>

        <div className="max-w-6xl mx-auto relative">
          {featureStoryChapters.map((chapter, index) => (
            <div key={chapter.id} className="relative">
              {index > 0 && (
                <div className="mx-auto max-w-md border-t border-dashed border-white/10" aria-hidden="true" />
              )}
              <FeatureStoryChapterRow chapter={chapter} index={index} />
            </div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center pb-20 pt-4"
        >
          <p className="text-slate-400 mb-6">Prêt à vivre ce parcours dans votre quotidien ?</p>
          <Link href="/login">
            <Button size="lg" className="rounded-full h-12 px-7 text-sm sm:text-base font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-lg hover:shadow-xl transition-all duration-200 group active:scale-[0.98] min-w-[220px]" data-testid="button-story-cta">
              Accéder à la plateforme <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// Tutoriels pour chaque profil
const profileTutorials: Record<string, { steps: string[]; tips: string[] }> = {
  admin: {
    steps: [
      "Connectez-vous avec vos identifiants admin",
      "Accédez au tableau de bord administrateur pour une vue d'ensemble complète",
      "Gérez les utilisateurs via le menu 'Utilisateurs' - créez, modifiez ou désactivez des comptes",
      "Configurez les paramètres système dans 'Settings'",
      "Consultez les rapports globaux et exportez les données en Excel",
      "Surveillez les alertes critiques et les KPIs en temps réel"
    ],
    tips: [
      "Utilisez les filtres pour segmenter les données par période",
      "Exportez régulièrement les rapports pour vos analyses",
      "Configurez les notifications pour rester informé des événements critiques"
    ]
  },
  workshop_manager: {
    steps: [
      "Accédez au dashboard Chef d'Atelier pour voir vos KPIs de maintenance",
      "Planifiez la maintenance préventive dans 'Maintenance > Planificateur'",
      "Créez et assignez des ordres de travail à votre équipe",
      "Suivez l'avancement des interventions en cours",
      "Gérez les demandes de pièces et validez les commandes",
      "Consultez les rapports de performance de l'atelier"
    ],
    tips: [
      "Priorisez les ordres de travail selon l'urgence et la disponibilité",
      "Vérifiez quotidiennement les alertes de maintenance préventive",
      "Communiquez avec votre équipe via les commentaires sur les ordres"
    ]
  },
  technician: {
    steps: [
      "Consultez vos ordres de travail assignés sur le dashboard technicien",
      "Ouvrez un ordre de travail pour voir les détails de l'intervention",
      "Enregistrez les pièces utilisées et le temps passé",
      "Ajoutez des photos et commentaires sur l'intervention",
      "Marquez l'ordre comme terminé une fois le travail effectué",
      "Consultez l'historique de vos interventions"
    ],
    tips: [
      "Prenez des photos avant/après pour documenter votre travail",
      "Notez tous les problèmes détectés même s'ils ne sont pas dans l'ordre",
      "Validez toujours les pièces utilisées pour un suivi précis"
    ]
  },
  secretary: {
    steps: [
      "Accédez au tableau de bord secrétariat",
      "Gérez les factures clients dans 'Opérations > Factures'",
      "Créez de nouvelles factures pour les missions effectuées",
      "Suivez les paiements et relancez les factures en retard",
      "Consultez et exportez les documents administratifs",
      "Gérez les contacts clients et fournisseurs"
    ],
    tips: [
      "Vérifiez quotidiennement les factures en attente de paiement",
      "Exportez les factures mensuelles pour la comptabilité",
      "Configurez des alertes pour les échéances de paiement"
    ]
  },
  logistics: {
    steps: [
      "Consultez le planning des missions sur votre dashboard",
      "Créez de nouvelles missions client avec détails complets",
      "Assignez les véhicules et chauffeurs disponibles",
      "Suivez l'état des missions en cours en temps réel",
      "Validez les missions terminées et générez les rapports",
      "Consultez les statistiques de performance logistique"
    ],
    tips: [
      "Planifiez les missions en tenant compte de la maintenance préventive",
      "Optimisez les trajets pour réduire les coûts de carburant",
      "Communiquez avec les chauffeurs pour les mises à jour"
    ]
  },
  warehouse: {
    steps: [
      "Accédez au dashboard magasinier pour voir l'état des stocks",
      "Consultez l'inventaire des pièces dans 'Inventaire > Pièces'",
      "Traitez les demandes de pièces des techniciens",
      "Enregistrez les réceptions de commandes fournisseurs",
      "Gérez les alertes de stock faible et passez des commandes",
      "Effectuez des inventaires physiques réguliers"
    ],
    tips: [
      "Définissez des seuils de stock minimum pour éviter les ruptures",
      "Groupez les commandes par fournisseur pour optimiser les coûts",
      "Vérifiez toujours les quantités à la réception"
    ]
  },
  client: {
    steps: [
      "Connectez-vous pour accéder à votre espace client sécurisé",
      "Consultez l'état et la disponibilité de votre flotte dédiée",
      "Suivez l'avancement de vos missions de transport en temps réel",
      "Visualisez et téléchargez vos factures et justificatifs",
      "Consultez l'historique complet des interventions sur vos véhicules"
    ],
    tips: [
      "Téléchargez vos factures et rapports d'interventions en PDF",
      "Suivez régulièrement l'avancement de vos missions en direct",
      "Vos accès sont strictement cloisonnés à vos véhicules d'entreprise"
    ]
  },
  management: {
    steps: [
      "Connectez-vous avec votre compte Direction créé par l'administrateur",
      "Accédez au tableau de bord exécutif Direction pour consulter le CA et la marge",
      "Analysez les flux financiers : CA facturé, encaissé et charges directes",
      "Consultez le classement des top clients et des lignes les plus rentables",
      "Examinez la disponibilité de la flotte en un coup d'œil",
      "Exportez le rapport mensuel Direction en PDF pour votre comité de direction"
    ],
    tips: [
      "Filtrez par période (mois en cours, trimestre) pour analyser la dynamique",
      "Consultez les impayés pour anticiper le besoin en fonds de roulement",
      "La marge brute est calculée strictement en HT pour une fidélité comptable parfaite"
    ]
  },
  driver: {
    steps: [
      "Accédez à l'application mobile PWA sur votre smartphone ou tablette",
      "Connectez-vous rapidement avec votre identifiant chauffeur et votre code PIN à 4 chiffres",
      "Consultez votre mission active du jour et votre destination",
      "Prenez connaissance des détails de la feuille de route et du véhicule assigné",
      "Enregistrez votre kilométrage au départ puis à l'arrivée",
      "Signalez toute anomalie ou incident directement depuis votre mobile"
    ],
    tips: [
      "Installez l'application sur l'écran d'accueil de votre téléphone pour un accès direct",
      "Vérifiez vos documents de bord avant chaque départ en mission",
      "En cas d'oubli de PIN, contactez la secrétaire ou le logisticien pour le réinitialiser"
    ]
  }
};

function HeroLiveCockpit() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      {/* Halo de fond émeraude / cyan */}
      <div className="absolute -inset-1.5 rounded-3xl bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-cyan-500/20 opacity-70 blur-2xl -z-10" />

      {/* Cadre principal en verre sombre */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2 }}
        className="relative rounded-2xl border border-white/15 bg-slate-950/75 backdrop-blur-xl p-5 md:p-6 shadow-2xl shadow-emerald-950/40 space-y-4 overflow-hidden"
      >
        {/* Ligne lumineuse en haut */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />

        {/* En-tête du cockpit */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cockpit Opérationnel</div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                Flotte Active
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            </div>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs px-2.5 py-0.5">
            Temps Réel
          </Badge>
        </div>

        {/* Carte Véhicule principal */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/20 text-emerald-300">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold text-white tracking-wide">LT-9034 <span className="text-xs font-normal text-slate-400">(Actros 3340)</span></div>
                <div className="text-xs text-emerald-300 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                  En mission • Douala → Yaoundé
                </div>
              </div>
            </div>
            <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
              Opérationnel
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div className="rounded-lg bg-black/20 p-2 border border-white/5">
              <div className="text-[11px] text-slate-400">Carburant</div>
              <div className="text-xs font-bold text-emerald-300">84%</div>
            </div>
            <div className="rounded-lg bg-black/20 p-2 border border-white/5">
              <div className="text-[11px] text-slate-400">Kilométrage</div>
              <div className="text-xs font-bold text-white">142 850 km</div>
            </div>
            <div className="rounded-lg bg-black/20 p-2 border border-white/5">
              <div className="text-[11px] text-slate-400">Documents</div>
              <div className="text-xs font-bold text-teal-300">Conformes</div>
            </div>
          </div>
        </div>

        {/* Carte Ordre de Travail / Maintenance en cours */}
        <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-950/30 to-slate-900/50 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-blue-400" />
              <span className="text-xs font-semibold text-blue-300">OT #2847 — Révision & Filtration</span>
            </div>
            <span className="text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
              En cours (75%)
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Technicien : <strong className="text-white">K. Moussa</strong></span>
            <span className="text-emerald-300">Sortie du stock : Validée</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-blue-500 via-teal-400 to-emerald-400" />
          </div>
        </div>

        {/* Micro-notifications intégrées */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="text-[11px] leading-tight text-slate-300">
              <strong className="text-white">Contrôle 3 voies</strong> : Bon & Facture rapprochés
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
            <Sparkles className="h-4 w-4 text-teal-300 shrink-0" />
            <div className="text-[11px] leading-tight text-slate-300">
              <strong className="text-white">Synchronisation</strong> : 7 rôles connectés
            </div>
          </div>
        </div>
      </motion.div>
{/* Badge flottant décoratif */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="hidden sm:flex absolute -top-4 -right-4 items-center gap-2 rounded-xl border border-emerald-500/30 bg-slate-900/90 backdrop-blur-md px-3.5 py-2 shadow-lg shadow-emerald-950/50 text-xs font-medium text-white"
      >
        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
        <span>Disponibilité Flotte : <strong className="text-emerald-300">96.8%</strong></span>
      </motion.div>
    </div>
  );
}

// Composant Storytelling Transformation Avant / Après
function StorytellingTransformationSection() {
  const [tab, setTab] = useState<"before" | "after">("after");

  return (
    <section className="relative py-20 lg:py-28 bg-slate-950/75 backdrop-blur-sm text-white overflow-hidden border-t border-white/10">
      {/* Halo ambiant diffus */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-emerald-500/15 blur-3xl -z-10 pointer-events-none" />

      <div className="container mx-auto px-4">
        {/* En-tête de section */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <Badge variant="outline" className="mb-4 bg-emerald-500/10 text-emerald-300 border-emerald-500/30 px-3.5 py-1 inline-flex items-center gap-1.5 text-xs font-medium rounded-full">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            Impact Opérationnel • Corridors CEMAC
          </Badge>
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white mb-4">
            La transformation de votre{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              quotidien logistique
            </span>
          </h2>
          <p className="text-slate-300 text-base md:text-lg mb-8 leading-relaxed">
            Mesurez concrètement l'écart entre la gestion manuelle sur papier et la puissance d'un cockpit unifié en temps réel.
          </p>

          {/* Sélecteur interactif Google-like (Pill Switcher) */}
          <div className="inline-flex items-center p-1.5 rounded-full bg-slate-900/90 border border-white/15 backdrop-blur-xl shadow-xl">
            <button
              onClick={() => setTab("before")}
              data-testid="toggle-story-before"
              className={`px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
                tab === "before"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${tab === "before" ? "bg-rose-400 animate-pulse" : "bg-slate-500"}`} />
              Sans Yaro FleetOS (Manuel)
            </button>
            <button
              onClick={() => setTab("after")}
              data-testid="toggle-story-after"
              className={`px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
                tab === "after"
                  ? "bg-white text-slate-950 shadow-lg hover:bg-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${tab === "after" ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
              Avec Yaro FleetOS (Digital)
            </button>
          </div>
        </div>

        {/* Contenu dynamique Avant / Après avec transition fluide */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-6xl mx-auto rounded-3xl border border-white/15 bg-gradient-to-b from-slate-900/70 to-slate-950/80 backdrop-blur-2xl shadow-2xl p-6 sm:p-8 lg:p-10 overflow-hidden"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            {/* Colonne Image avec badge flottant */}
            <div className="lg:col-span-6 relative group">
              <div className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
                <img
                  src={tab === "before" ? "/storytelling/director-before.jpg" : "/storytelling/director-after.jpg"}
                  alt={tab === "before" ? "Gestion manuelle avant Yaro FleetOS" : "Contrôle en direct avec Yaro FleetOS"}
                  className="w-full h-[320px] sm:h-[400px] object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

                {/* Badge flottant en bas de l'image */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md border shadow-lg ${
                      tab === "before"
                        ? "bg-rose-950/80 text-rose-300 border-rose-500/40"
                        : "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                    }`}
                  >
                    {tab === "before" ? (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        Pertes de données & Surcharge mentale
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        Contrôle 100% Digital & Sérénité
                      </>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-300 bg-slate-950/70 px-2.5 py-1 rounded-full border border-white/10 backdrop-blur-md">
                    Corridor Douala — Garoua
                  </span>
                </div>
              </div>
            </div>

            {/* Colonne Détails & Points Clés */}
            <div className="lg:col-span-6 space-y-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
                  {tab === "before" ? "État des lieux sans logiciel" : "Expérience avec FleetOS"}
                </div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                  {tab === "before"
                    ? "Le fardeau de la paperasse, des fiches égarées et des litiges"
                    : "Un poste de commandement unifié, fluide et sans angle mort"}
                </h3>
                <p className="text-slate-300 text-sm sm:text-base mt-3 leading-relaxed">
                  {tab === "before"
                    ? "Sans synchronisation en direct entre l'atelier, la route et la direction, chaque imprévu entraîne des retards coûteux, des litiges fournisseurs et une usure prématurée de la flotte."
                    : "Grâce à la synchronisation WebSocket temps réel, les 9 profils collaborent sur la même vérité. Les pannes sont anticipées, le carburant est maîtrisé et la rentabilité est visible en direct."}
                </p>
              </div>

              {/* 4 Puces Comparatives */}
              <div className="space-y-3 pt-2">
                {tab === "before" ? (
                  <>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
                      <XCircle className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Manifestes & bons de livraison papier</span>
                        <p className="text-xs text-slate-400 mt-0.5">Documents physiques égarés sur le trajet Douala - Ngaoundéré - Garoua, retards de validation.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
                      <XCircle className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Stock atelier opaque & pièces introuvables</span>
                        <p className="text-xs text-slate-400 mt-0.5">Camions immobilisés des jours entiers faute de pièces répertoriées ou commandées à temps.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
                      <XCircle className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Anomalies de carburant invisibles</span>
                        <p className="text-xs text-slate-400 mt-0.5">Surconsommations et écarts de litrage découverts trop tard, sans lien direct avec les kilomètres réels.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
                      <XCircle className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Marge et rentabilité découvertes en fin de mois</span>
                        <p className="text-xs text-slate-400 mt-0.5">La Direction navigue à vue sur les impayés et la rentabilité réelle de chaque client ou marchandise.</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Traçabilité numérique intégrale des corridors</span>
                        <p className="text-xs text-slate-300 mt-0.5">Feuilles de route numériques, relevés kilométriques départ/arrivée sur smartphone chauffeur.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">GMAO & 487 pièces en stock synchronisées</span>
                        <p className="text-xs text-slate-300 mt-0.5">Alertes automatiques stock bas, sorties réservées pour les OT et historique pneus au kilomètre.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Contrôle 3 voies & détection anomalies carburant</span>
                        <p className="text-xs text-slate-300 mt-0.5">Rapprochement automatique Bon de commande / Réception / Facture et alertes surconsommation.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-sm font-semibold text-white">Marge brute HT & Top rentabilité en temps réel</span>
                        <p className="text-xs text-slate-300 mt-0.5">Dashboard exécutif pour le DG avec CA facturé, encaissé et board pack mensuel en PDF.</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Bouton d'action contextuel */}
              <div className="pt-2">
                {tab === "before" ? (
                  <Button
                    size="lg"
                    onClick={() => setTab("after")}
                    className="rounded-full h-11 px-6 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md transition-all duration-200 group active:scale-[0.98]"
                  >
                    Voir la transformation avec Yaro FleetOS <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                ) : (
                  <Link href="/login">
                    <Button
                      size="lg"
                      className="rounded-full h-11 px-7 text-sm font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-xl transition-all duration-200 group active:scale-[0.98]"
                    >
                      Accéder à la plateforme <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  // Si connecté, rediriger vers le dashboard sans reload complet
  useEffect(() => {
    if (isAuthenticated && user) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, user, setLocation]);

  if (isAuthenticated && user) return null;

  return (
    <div className="min-h-screen text-foreground">
      {/* Vidéo d'arrière-plan */}
      <VideoBackground opacity={0.85} />

      {/* Header moderne avec logo, navigation rapide et bouton connexion */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-slate-950/70 border-b border-white/10 transition-all">
        <div className="container mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/logo.jpg" 
              alt="Yaro FleetOS Logo"
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/20 shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white tracking-tight">Yaro FleetOS</span>
                <Badge variant="outline" className="hidden sm:inline-flex border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] px-1.5 py-0">
                  v2.0
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">CMMS & Fleet Management</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <a href="#features" className="hover:text-emerald-400 transition-colors">
              Fonctionnalités
            </a>
            <a href="#profiles" className="hover:text-emerald-400 transition-colors">
              9 Rôles Métier
            </a>
            <a href="#transformation" className="hover:text-emerald-400 transition-colors">
              Transformation
            </a>
            <a href="#stats" className="hover:text-emerald-400 transition-colors">
              Chiffres Clés
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Système actif</span>
            </div>
            <Link href="/login">
              <Button data-testid="button-login-header" className="rounded-full h-9 px-5 text-sm font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-sm hover:shadow-md transition-all duration-200 active:scale-95 border-0">
                Connexion
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Section Hero Modernisée */}
      <section className="relative py-12 md:py-20 lg:py-28 overflow-hidden">
        {/* Halo ambiant supérieur */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-b from-emerald-500/15 via-teal-500/5 to-transparent blur-3xl -z-10 pointer-events-none" />

        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Colonne Gauche: Copywriting & CTA */}
            <motion.div 
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="lg:col-span-7 space-y-6 text-left"
            >
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-md text-emerald-300 text-xs sm:text-sm font-medium shadow-sm shadow-emerald-950/30" data-testid="badge-cmms">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Plateforme Logistique & CMMS • Temps Réel</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                Pilotez votre flotte & vos ateliers avec une{" "}
                <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
                  précision absolue
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl">
                Le système d'exploitation unifié pour le transport lourd et la maintenance industrielle. Synchronisez en continu la route, l'atelier mécanique, le magasin de pièces et la comptabilité.
              </p>

              <div className="flex flex-col sm:flex-row gap-3.5 pt-2">
                <Link href="/login">
                  <Button size="lg" className="rounded-full h-12 px-7 text-sm sm:text-base font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-xl hover:shadow-2xl transition-all duration-200 group active:scale-[0.98] min-w-[200px]" data-testid="button-start">
                    Accéder à la plateforme <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline" className="rounded-full h-12 px-6 text-sm sm:text-base font-medium bg-white/5 hover:bg-white/10 text-white border-white/20 hover:border-white/30 backdrop-blur-md transition-all duration-200 active:scale-[0.98] min-w-[180px]" data-testid="button-learn-more" asChild>
                  <a href="#features">Découvrir le parcours</a>
                </Button>
              </div>

              {/* Indicateurs clés intégrés au Hero */}
              <div className="pt-6 border-t border-white/10 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white">45+</div>
                  <div className="text-xs text-slate-400">Véhicules pilotés</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400">100%</div>
                  <div className="text-xs text-slate-400">Traçabilité pièces & OT</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-teal-300">9 Rôles</div>
                  <div className="text-xs text-slate-400">Interconnectés en direct</div>
                </div>
              </div>
            </motion.div>

            {/* Colonne Droite: Mockup Cockpit Interactif */}
            <div className="lg:col-span-5">
              <HeroLiveCockpit />
            </div>
          </div>
        </div>
      </section>

      {/* Section Profils Utilisateurs — Transition fluide & translucide */}
      <section id="profiles" className="relative py-20 lg:py-28 bg-slate-950/70 backdrop-blur-sm text-white overflow-hidden border-t border-white/10">
        {/* Ligne séparatrice lumineuse supérieure et halo */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-emerald-500/5 blur-3xl -z-10 pointer-events-none" />

        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <Badge variant="outline" className="mb-4 bg-emerald-500/10 text-emerald-300 border-emerald-500/30 px-3 py-1 inline-flex items-center gap-1.5 text-xs font-medium">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              Gouvernance & Sécurité RBAC
            </Badge>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white mb-4">
              9 Profils Métier,{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
                une collaboration fluide
              </span>
            </h2>
            <p className="text-slate-400 text-base md:text-lg mb-4 leading-relaxed">
              Des accès sur mesure et une séparation rigoureuse des responsabilités pour les 9 rôles clés de votre organisation.
            </p>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300">
              <Info className="h-3.5 w-3.5 text-emerald-400" />
              <span>Cliquez sur un profil pour ouvrir son guide d'utilisation pas à pas</span>
            </div>
          </div>

          {/* Grille des 9 cartes de profils avec effets glassmorphism */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6 mb-20">
            {userProfiles.map((profile, idx) => {
              const Icon = profile.icon;
              return (
                <motion.div
                  key={profile.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: idx * 0.05 }}
                  className="h-full"
                >
                  <Card 
                    className="h-full bg-slate-900/60 backdrop-blur-xl border-white/10 hover:border-emerald-500/40 hover:bg-slate-900/90 transition-all duration-300 cursor-pointer group flex flex-col justify-between hover:shadow-xl hover:shadow-emerald-950/30 hover:-translate-y-1.5 relative overflow-hidden" 
                    data-testid={`card-profile-${profile.id}`}
                    onClick={() => setSelectedProfile(profile.id)}
                  >
                    {/* Glow discret au survol */}
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/15 transition-all duration-500 pointer-events-none" />

                    <CardHeader className="pb-3 relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <div className={`h-11 w-11 rounded-xl ${profile.bgColor} border border-white/10 flex items-center justify-center transition-transform group-hover:scale-105 duration-300`}>
                          <Icon className={`h-5 w-5 ${profile.color}`} />
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400 group-hover:text-emerald-300 flex items-center gap-1 transition-colors">
                          {PROFILE_DEMO_VIDEOS[profile.id] && (
                            <span className="flex items-center gap-1 mr-1.5 text-primary-text" data-testid={`badge-video-${profile.id}`}>
                              <PlayCircle className="h-3.5 w-3.5" /> Vidéo
                            </span>
                          )}
                          Guide <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                      <CardTitle className="text-lg font-bold text-white group-hover:text-emerald-200 transition-colors">
                        {profile.name}
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-400 leading-relaxed min-h-[36px]">
                        {profile.description}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-3 pt-0 relative z-10">
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Périmètre d'action</div>
                        <div className="flex flex-wrap gap-1">
                          {profile.permissions.map((perm) => (
                            <Badge key={perm} variant="secondary" className="text-[10px] px-2 py-0.5 bg-white/5 hover:bg-white/10 text-slate-300 border-white/5">
                              {perm}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
                        <span>Rôle système</span>
                        <span className="font-semibold text-emerald-400 text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          Actif
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Tableau comparatif des permissions façon cockpit */}
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-8">
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">Matrice des Permissions & Contrôle d'Accès</h3>
              <p className="text-sm text-slate-400">Contrôle granulaire selon le principe du moindre privilège</p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/15 bg-slate-900/60 backdrop-blur-xl shadow-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className="p-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Module / Fonctionnalité</th>
                    {userProfiles.map((profile) => (
                      <th key={profile.id} className="p-3 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <div className={`h-8 w-8 rounded-lg ${profile.bgColor} border border-white/10 flex items-center justify-center`}>
                            <profile.icon className={`h-4 w-4 ${profile.color}`} />
                          </div>
                          <span className="text-[11px] font-medium text-slate-300 hidden lg:inline">{profile.name}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {Object.entries(permissionsMatrix).map(([feature, roles]) => (
                    <tr key={feature} className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 text-sm font-medium text-slate-200">{feature}</td>
                      {userProfiles.map((profile) => (
                        <td key={profile.id} className="p-3.5 text-center">
                          {roles[profile.id as keyof typeof roles] ? (
                            <div className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mx-auto">
                              <CheckCircle2 className="h-4 w-4" data-testid={`check-${profile.id}-${feature}`} />
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-center h-6 w-6 text-slate-600 mx-auto">
                              <Minus className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Section Storytelling Transformation Avant / Après */}
      <div id="transformation">
        <StorytellingTransformationSection />
      </div>

      <FeatureStorySection />

      {/* Section Statistiques — Dark Glassmorphic Translucide */}
      <section id="stats" className="relative py-20 bg-slate-950/70 backdrop-blur-sm text-white border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            <div className="space-y-2 p-6 rounded-2xl bg-slate-900/60 border border-white/10 backdrop-blur-xl">
              <TrendingUp className="h-8 w-8 text-emerald-400 mx-auto" />
              <CountUp end={45} suffix="+" className="text-3xl font-extrabold text-white" />
              <div className="text-sm text-slate-400">Véhicules sous contrôle</div>
            </div>
            <div className="space-y-2 p-6 rounded-2xl bg-slate-900/60 border border-white/10 backdrop-blur-xl">
              <Clock className="h-8 w-8 text-blue-400 mx-auto" />
              <CountUp end={100} suffix="%" className="text-3xl font-extrabold text-white" />
              <div className="text-sm text-slate-400">Maintenance planifiée</div>
            </div>
            <div className="space-y-2 p-6 rounded-2xl bg-slate-900/60 border border-white/10 backdrop-blur-xl">
              <Package className="h-8 w-8 text-teal-400 mx-auto" />
              <CountUp end={12} className="text-3xl font-extrabold text-white" />
              <div className="text-sm text-slate-400">Fournisseurs intégrés</div>
            </div>
            <div className="space-y-2 p-6 rounded-2xl bg-slate-900/60 border border-white/10 backdrop-blur-xl">
              <BarChart3 className="h-8 w-8 text-cyan-400 mx-auto" />
              <div className="text-3xl font-extrabold text-white">24/7</div>
              <div className="text-sm text-slate-400">Suivi temps réel actif</div>
            </div>
          </div>
        </div>
      </section>

      {/* Section CTA Finale — Google Cloud Style */}
      <section className="relative py-24 bg-slate-950/65 backdrop-blur-sm text-white border-t border-white/10 overflow-hidden">
        {/* Halo ambiant diffus */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[300px] bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-cyan-500/15 blur-3xl -z-10 pointer-events-none" />

        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto rounded-3xl border border-white/15 bg-gradient-to-b from-slate-900/80 to-slate-950/90 backdrop-blur-2xl shadow-2xl p-8 sm:p-12 md:p-14 text-center relative overflow-hidden">
            {/* Ligne accent Google-like en haut */}
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400" />

            <Badge variant="outline" className="mb-4 bg-emerald-500/10 text-emerald-300 border-emerald-500/30 px-3.5 py-1 text-xs font-medium rounded-full inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              Déploiement Immédiat
            </Badge>

            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
              Prêt à optimiser la gestion de votre flotte ?
            </h2>

            <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
              Connectez la route, l'atelier mécanique et la facturation sur une plateforme unique conçue pour le transport lourd.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
              <Link href="/login">
                <Button size="lg" className="rounded-full h-12 sm:h-13 px-8 text-sm sm:text-base font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-xl hover:shadow-2xl transition-all duration-200 group active:scale-[0.98] min-w-[220px]" data-testid="button-cta-start">
                  Accéder à la plateforme <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="rounded-full h-12 sm:h-13 px-7 text-sm sm:text-base font-medium text-white border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 backdrop-blur-md transition-all duration-200 active:scale-[0.98] min-w-[200px]" asChild>
                <a href="#profiles">Explorer les 9 rôles</a>
              </Button>
            </div>

            {/* Réassurance épurée façon Google */}
            <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-center gap-6 text-xs sm:text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>9 profils métier prêts à l'emploi</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Synchronisation temps réel WebSocket</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>100% Web & Mobile</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer Translucide */}
      <footer className="relative py-8 border-t border-white/10 bg-slate-950/75 text-slate-400 backdrop-blur-sm">
        <div className="container mx-auto px-4 text-center text-sm">
          <p>&copy; {new Date().getFullYear()} Yaro FleetOS. Tous droits réservés.</p>
          <span className="mt-1.5 block text-slate-400"><span className="font-['Pinyon_Script'] text-2xl text-emerald-400 italic">by</span> Trigenys Group</span>
        </div>
      </footer>

      {/* Modal de tutoriel */}
      <Dialog open={selectedProfile !== null} onOpenChange={(open) => !open && setSelectedProfile(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedProfile && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 text-2xl">
                  {(() => {
                    const profile = userProfiles.find(p => p.id === selectedProfile);
                    if (!profile) return null;
                    const Icon = profile.icon;
                    return (
                      <>
                        <div className={`h-12 w-12 rounded-lg ${profile.bgColor} flex items-center justify-center`}>
                          <Icon className={`h-6 w-6 ${profile.color}`} />
                        </div>
                        Guide {profile.name}
                      </>
                    );
                  })()}
                </DialogTitle>
                <DialogDescription>
                  Guide d'utilisation pas à pas pour le profil {userProfiles.find(p => p.id === selectedProfile)?.name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {PROFILE_DEMO_VIDEOS[selectedProfile] && (
                  <div>
                    <h4 className="font-semibold text-lg mb-3 flex items-center gap-2">
                      <PlayCircle className="h-5 w-5 text-primary-text" /> Vidéo de démonstration
                    </h4>
                    <video
                      key={selectedProfile}
                      src={PROFILE_DEMO_VIDEOS[selectedProfile]}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full rounded-lg border border-white/10 bg-black aspect-video"
                      data-testid={`video-demo-${selectedProfile}`}
                    />
                  </div>
                )}

                {/* Identifiants et accès */}
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-emerald-400 mb-1 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Accès &amp; Authentification
                  </h4>
                  <p className="text-xs text-slate-300">Connexion sécurisée via identifiants d'entreprise ou code PIN chauffeur personnel.</p>
                </div>

                {/* Étapes du guide */}
                <div>
                  <h4 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-400" /> Étapes à suivre
                  </h4>
                  <ol className="space-y-3">
                    {profileTutorials[selectedProfile]?.steps.map((step, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </span>
                        <span className="text-sm text-foreground/90">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Conseils */}
                <div>
                  <h4 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-amber-400" /> Conseils pratiques
                  </h4>
                  <ul className="space-y-2">
                    {profileTutorials[selectedProfile]?.tips.map((tip, index) => (
                      <li key={index} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="text-emerald-400">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Bouton d'action */}
                <div className="pt-4 border-t border-border">
                  <Link href="/login">
                    <Button className="w-full rounded-full h-11 text-sm font-semibold bg-white text-slate-950 hover:bg-slate-100 shadow-md hover:shadow-lg transition-all duration-200" size="lg">
                      Se connecter maintenant <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
