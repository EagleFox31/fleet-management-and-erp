import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import TayLogoImg from '@assets/WhatsApp Image 2025-05-15 à 22.27.37_2f9100f5.jpg';
import {
  Eye, EyeOff, Truck, Wrench, BarChart3, Users,
  ShieldCheck, Clock, ArrowRight, User, Lock, ChevronLeft,
} from "lucide-react";
import { useAnimatedError } from "@/hooks/use-animated-error";

const loginFormSchema = z.object({
  username: z.string().min(1, "Nom d'utilisateur requis"),
  password: z.string().min(1, "Mot de passe requis"),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

const features = [
  {
    icon: Clock,
    label: "Tracking temps réel",
    desc: "GPS & télémétrie véhicule",
    badge: "LIVE",
  },
  {
    icon: Wrench,
    label: "Ordres de travail CMMS",
    desc: "Maintenance préventive & corrective",
    badge: null,
  },
  {
    icon: BarChart3,
    label: "KPIs & Rapports avancés",
    desc: "Tableaux de bord opérationnels",
    badge: null,
  },
  {
    icon: Users,
    label: "Accès multi-rôles",
    desc: "Chauffeurs, Mécaniciens, Managers",
    badge: null,
  },
];


export default function Login() {
  const { login, isAuthenticating, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [view, setView] = useState<'login' | 'forgot' | 'driver-select' | 'driver-pin'>('login');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const { handleApiError } = useAnimatedError();
  const [selectedDriver, setSelectedDriver] = useState<{ id: number; name: string } | null>(null);
  const [driversList, setDriversList] = useState<{ id: number; name: string }[]>([]);
  const [pinDigits, setPinDigits] = useState<string[]>([]);
  const [pinError, setPinError] = useState(false);
  const [driversLoading, setDriversLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    setLoginError(null);
    try {
      const success = await login({ ...values, rememberMe });
      if (!success) setLoginError("Identifiants incorrects. Veuillez réessayer.");
    } catch (error) {
      handleApiError(error);
      setLoginError("Erreur de connexion. Veuillez réessayer.");
    }
  }

  function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (forgotUsername.trim()) setForgotSent(true);
  }

  useEffect(() => {
    if (view === 'driver-select') {
      setDriversLoading(true);
      fetch('/api/auth/drivers-list')
        .then(r => r.json())
        .then(data => { setDriversList(Array.isArray(data) ? data : []); setDriversLoading(false); })
        .catch(() => setDriversLoading(false));
    }
  }, [view]);

  async function handlePinSubmit(digits: string[]) {
    const pin = digits.join('');
    if (!selectedDriver) return;
    try {
      const res = await fetch('/api/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: selectedDriver.id, pin }),
      });
      if (!res.ok) {
        setPinError(true);
        setPinDigits([]);
        setTimeout(() => setPinError(false), 600);
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setPinError(true);
      setPinDigits([]);
      setTimeout(() => setPinError(false), 600);
    }
  }

  function handleNumpadPress(key: string) {
    if (key === '⌫') {
      setPinDigits(d => d.slice(0, -1));
      return;
    }
    if (pinDigits.length >= 4) return;
    const next = [...pinDigits, key];
    setPinDigits(next);
    if (next.length === 4) {
      handlePinSubmit(next);
    }
  }

  const numpadKeys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  function getDriverInitials(name: string) {
    return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">

      {/* ══════════════════════════════
          PANNEAU GAUCHE — Branding
      ══════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[55%] h-full flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #0b2116 0%, #071610 50%, #040d08 100%)" }}
      >
        {/* Vidéo */}
        <video autoPlay loop muted playsInline aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-[0.18] pointer-events-none">
          <source src="/fleet-video.mp4" type="video/mp4" />
        </video>

        {/* Dot grid texture */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(rgba(74,222,128,0.12) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }} />

        {/* Glow radial top-left */}
        <div className="absolute -top-48 -left-48 w-[700px] h-[700px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 65%)" }} />
        {/* Glow radial bottom-right */}
        <div className="absolute -bottom-32 right-0 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(34,197,94,0.05) 0%, transparent 65%)" }} />

        <div className="relative z-10 flex flex-col h-full px-12 py-10">

          {/* Logo header */}
          <div className="flex items-center gap-3.5 mb-12">
            <div className="w-12 h-12 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-xl shrink-0">
              <img src={TayLogoImg} alt="T.A.Y Logo" className="w-full h-full object-cover" />
            </div>
            <div className="leading-tight">
              <p className="text-white font-bold text-[16px] tracking-tight">Yaro FleetOS</p>
              <p className="text-white/30 text-[10px] tracking-widest uppercase">V2.0 · CMMS · ERP</p>
            </div>
          </div>

          {/* Badge ERP */}
          <div className="mb-6">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10.5px] font-bold tracking-widest"
              style={{
                color: "#f59e0b",
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.25)",
              }}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
              PLATEFORME ERP LOGISTIQUE
            </span>
          </div>

          {/* Titre impactant */}
          <h1 className="font-black leading-[1.05] tracking-tight mb-5" style={{ fontSize: "3.2rem" }}>
            <span className="text-white block">La logistique</span>
            <span className="block" style={{ color: "#4ade80" }}>camerounaise</span>
            <span className="block" style={{ color: "#f59e0b" }}>réinventée.</span>
          </h1>

          <p className="text-white/40 text-[13.5px] leading-relaxed mb-10 max-w-[340px]">
            Gérez votre flotte de Douala à Yaoundé, pilotez la
            maintenance CMMS et suivez chaque véhicule en temps
            réel — depuis un seul tableau de bord.
          </p>

          {/* Feature cards */}
          <div className="space-y-2.5 flex-1">
            {features.map(({ icon: Icon, label, desc, badge }) => (
              <div
                key={label}
                className="flex items-center gap-4 px-4 py-3.5 rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.18)" }}>
                  <Icon className="w-4 h-4" style={{ color: "#4ade80" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white/90 text-[13px] font-semibold leading-none mb-0.5">{label}</p>
                  <p className="text-white/30 text-[11.5px]">{desc}</p>
                </div>
                {badge && (
                  <span className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: "#4ade80", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.2)" }}>
                    {badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer branding */}
          <div className="mt-10">
            <div className="h-px mb-6" style={{ background: "rgba(255,255,255,0.07)" }} />
            <div className="flex items-end justify-between">
              <div>
                <p className="text-white/25 text-[9.5px] font-semibold tracking-widest uppercase mb-1">Opérateur</p>
                <p className="text-white/65 text-[12.5px] font-semibold">Transport ABOUBAKAR YARORO</p>
              </div>
              <div className="text-right">
                <p className="text-white/25 text-[9.5px] font-semibold tracking-widest uppercase mb-1">Propulsé par</p>
                <p className="text-[13px] font-bold" style={{ color: "#4ade80" }}>
                  <span className="font-['Pinyon_Script'] text-[17px] italic mr-0.5" style={{ color: "#4ade80" }}>by</span>
                  {" "}Trigenys Group
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════
          PANNEAU DROIT — Formulaire
      ══════════════════════════════ */}
      <div className="flex-1 h-full flex flex-col" style={{ background: "#f4f6f8" }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-10 pt-8 pb-0">
          {/* Left: back button + mobile logo */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              <span className="hidden sm:inline">Retour</span>
            </button>
            <div className="lg:hidden flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg overflow-hidden">
                <img src={TayLogoImg} alt="T.A.Y Logo" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-sm text-gray-900">Yaro FleetOS</span>
            </div>
          </div>

          {/* Badge SSL */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10.5px] font-medium bg-white"
            style={{ color: "#16a34a", borderColor: "rgba(22,163,74,0.25)" }}>
            <ShieldCheck className="w-3 h-3" />
            Connexion sécurisée SSL
          </div>
        </div>

        {/* Zone centrée — card formulaire */}
        <div className="flex-1 flex items-center justify-center px-6 py-8 overflow-hidden">
          <div className="w-full max-w-[440px] relative">

            {/* ── VUE CONNEXION ── */}
            <div
              className="transition-all duration-400 ease-in-out"
              style={{
                transform: view === 'login' ? 'translateX(0)' : 'translateX(-110%)',
                opacity: view === 'login' ? 1 : 0,
                position: view === 'login' ? 'relative' : 'absolute',
                width: '100%',
                pointerEvents: view === 'login' ? 'auto' : 'none',
              }}
            >
              {/* Card principale */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 px-8 py-9">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-5 h-0.5 rounded-full" style={{ background: "#16a34a" }} />
                  <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: "#16a34a" }}>
                    Espace sécurisé
                  </span>
                </div>
                <h2 className="font-black text-gray-900 leading-none mb-2.5 tracking-tight" style={{ fontSize: "2.6rem" }}>
                  Connexion<span style={{ color: "#16a34a" }}>.</span>
                </h2>
                <p className="text-[13.5px] text-gray-400 mb-8">Accédez à votre espace de gestion de flotte</p>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField control={form.control} name="username" render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">Nom d'utilisateur</p>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                            <Input placeholder="ex : ali.sawadogo" autoComplete="username"
                              data-testid="input-username"
                              className="h-[52px] pl-11 bg-gray-50 border-gray-200 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:border-emerald-400 transition-all placeholder:text-gray-300"
                              {...field} />
                          </div>
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="password" render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">Mot de passe</p>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                            <Input type={showPassword ? "text" : "password"} placeholder="••••••••" autoComplete="current-password"
                              data-testid="input-password"
                              className="h-[52px] pl-11 pr-12 bg-gray-50 border-gray-200 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:border-emerald-400 transition-all"
                              {...field} />
                            <button type="button" tabIndex={-1}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
                              onClick={() => setShowPassword(!showPassword)}>
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )} />

                    {/* Options */}
                    <div className="flex items-center justify-between pt-0.5">
                      <label className="flex items-center gap-2 cursor-pointer" onClick={() => setRememberMe(!rememberMe)}>
                        <div className="w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0"
                          style={{ background: rememberMe ? "#16a34a" : "white", borderColor: rememberMe ? "#16a34a" : "#d1d5db" }}>
                          {rememberMe && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-[12px] text-gray-500 select-none">Rester connecté <span className="text-gray-300">(30 j)</span></span>
                      </label>
                      <button type="button" onClick={() => { setView('forgot'); setForgotSent(false); setForgotUsername(''); }}
                        className="text-[12px] font-semibold hover:underline transition-colors" style={{ color: "#16a34a" }}>
                        Mot de passe oublié ?
                      </button>
                    </div>

                    {loginError && (
                      <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        <p className="text-red-600 text-[12px]">{loginError}</p>
                      </div>
                    )}

                    <div className="pt-1">
                      <Button type="submit" disabled={isAuthenticating}
                        data-testid="button-submit-login"
                        className="w-full h-[52px] rounded-xl text-[14px] font-bold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
                        style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)" }}>
                        {isAuthenticating ? (
                          <><span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Connexion en cours…</>
                        ) : (
                          <>Accéder au système<ArrowRight className="w-4 h-4" /></>
                        )}
                      </Button>
                    </div>

                    <div className="pt-2 border-t border-gray-100 mt-2">
                      <button
                        type="button"
                        onClick={() => setView('driver-select')}
                        className="w-full flex items-center justify-center gap-2 text-[13px] font-medium text-gray-500 hover:text-gray-700 py-2 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <Truck className="w-4 h-4" />
                        Connexion Chauffeur (PIN)
                      </button>
                    </div>
                  </form>
                </Form>
              </div>
            </div>

            {/* ── VUE MOT DE PASSE OUBLIÉ ── */}
            <div
              className="transition-all duration-400 ease-in-out"
              style={{
                transform: view === 'forgot' ? 'translateX(0)' : 'translateX(110%)',
                opacity: view === 'forgot' ? 1 : 0,
                position: view === 'forgot' ? 'relative' : 'absolute',
                top: 0,
                width: '100%',
                pointerEvents: view === 'forgot' ? 'auto' : 'none',
              }}
            >
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 px-8 py-9">
                <button onClick={() => setView('login')}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors mb-8">
                  <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                  Retour à la connexion
                </button>

                <div className="flex items-center gap-2 mb-5">
                  <div className="w-5 h-0.5 rounded-full" style={{ background: "#16a34a" }} />
                  <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: "#16a34a" }}>
                    Réinitialisation
                  </span>
                </div>
                <h2 className="font-black text-gray-900 leading-none mb-2.5 tracking-tight" style={{ fontSize: "2.2rem" }}>
                  Mot de passe<span style={{ color: "#16a34a" }}>.</span>
                </h2>

                {!forgotSent ? (
                  <>
                    <p className="text-[13.5px] text-gray-400 mb-8">
                      Entrez votre identifiant. Votre administrateur recevra une demande de réinitialisation.
                    </p>
                    <form onSubmit={handleForgotSubmit} className="space-y-5">
                      <div className="space-y-1.5">
                        <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">Nom d'utilisateur</p>
                        <div className="relative">
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                          <input value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
                            placeholder="ex : ali.sawadogo"
                            className="w-full h-[52px] pl-11 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all placeholder:text-gray-300"
                          />
                        </div>
                      </div>
                      <Button type="submit"
                        className="w-full h-[52px] rounded-xl text-[14px] font-bold text-white shadow-md transition-all duration-200"
                        style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)" }}>
                        Envoyer la demande
                      </Button>
                    </form>
                  </>
                ) : (
                  <div className="mt-4 p-5 rounded-2xl border border-emerald-100 bg-emerald-50">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                      style={{ background: "rgba(22,163,74,0.1)" }}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#16a34a" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-[13px] font-semibold text-gray-800 mb-1">Demande envoyée</p>
                    <p className="text-[12px] text-gray-500">
                      Votre administrateur a été notifié pour <span className="font-medium text-gray-700">{forgotUsername}</span>. Il vous recontactera pour réinitialiser votre mot de passe.
                    </p>
                    <button onClick={() => setView('login')}
                      className="mt-4 text-[12px] font-semibold hover:underline" style={{ color: "#16a34a" }}>
                      Retour à la connexion →
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── VUE SÉLECTION CHAUFFEUR ── */}
            <div
              className="transition-all duration-400 ease-in-out"
              style={{
                transform: view === 'driver-select' ? 'translateX(0)' : 'translateX(110%)',
                opacity: view === 'driver-select' ? 1 : 0,
                position: view === 'driver-select' ? 'relative' : 'absolute',
                top: 0,
                width: '100%',
                pointerEvents: view === 'driver-select' ? 'auto' : 'none',
                transition: 'all 0.4s ease-in-out',
              }}
            >
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 px-8 py-9">
                <button onClick={() => setView('login')}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors mb-8">
                  <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                  Retour à la connexion
                </button>

                <div className="flex items-center gap-2 mb-5">
                  <div className="w-5 h-0.5 rounded-full" style={{ background: "#16a34a" }} />
                  <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: "#16a34a" }}>
                    Connexion Chauffeur
                  </span>
                </div>
                <h2 className="font-black text-gray-900 leading-none mb-2.5 tracking-tight" style={{ fontSize: "2rem" }}>
                  Qui êtes-vous<span style={{ color: "#16a34a" }}>?</span>
                </h2>
                <p className="text-[13px] text-gray-400 mb-6">Sélectionnez votre nom pour continuer.</p>

                {driversLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <span className="h-6 w-6 rounded-full border-2 border-green-500/30 border-t-green-500 animate-spin" />
                  </div>
                ) : driversList.length === 0 ? (
                  <div className="py-8 text-center">
                    <Truck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">Aucun compte chauffeur disponible.</p>
                    <p className="text-[11px] text-gray-300 mt-1">Contactez votre administrateur.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {driversList.map(driver => (
                      <button
                        key={driver.id}
                        type="button"
                        onClick={() => { setSelectedDriver(driver); setPinDigits([]); setPinError(false); setView('driver-pin'); }}
                        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-100 hover:border-green-200 hover:bg-green-50/50 transition-all text-left group"
                      >
                        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                          <span className="text-green-700 font-bold text-[13px]">{getDriverInitials(driver.name)}</span>
                        </div>
                        <span className="flex-1 text-[14px] font-semibold text-gray-800 group-hover:text-green-700 transition-colors">
                          {driver.name}
                        </span>
                        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-green-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── VUE SAISIE PIN ── */}
            <div
              className="transition-all duration-400 ease-in-out"
              style={{
                transform: view === 'driver-pin' ? 'translateX(0)' : 'translateX(110%)',
                opacity: view === 'driver-pin' ? 1 : 0,
                position: view === 'driver-pin' ? 'relative' : 'absolute',
                top: 0,
                width: '100%',
                pointerEvents: view === 'driver-pin' ? 'auto' : 'none',
                transition: 'all 0.4s ease-in-out',
              }}
            >
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 px-8 py-9">
                <button onClick={() => { setView('driver-select'); setPinDigits([]); setPinError(false); }}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors mb-8">
                  <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                  Changer de chauffeur
                </button>

                <div className="flex items-center gap-2 mb-4">
                  <div className="w-5 h-0.5 rounded-full" style={{ background: "#16a34a" }} />
                  <span className="text-[10.5px] font-bold tracking-widest uppercase" style={{ color: "#16a34a" }}>
                    Connexion Chauffeur
                  </span>
                </div>

                {selectedDriver && (
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <span className="text-green-700 font-bold text-[14px]">{getDriverInitials(selectedDriver.name)}</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400 font-medium uppercase tracking-widest">Chauffeur sélectionné</p>
                      <p className="text-[16px] font-bold text-gray-900">{selectedDriver.name}</p>
                    </div>
                  </div>
                )}

                <p className="text-[13px] text-gray-500 mb-5 text-center">Entrez votre PIN à 4 chiffres</p>

                {/* PIN digit boxes */}
                <div className="flex justify-center gap-3 mb-6">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`w-12 h-12 border-2 rounded-xl flex items-center justify-center text-xl font-bold transition-all ${
                        pinError
                          ? 'border-red-400 bg-red-50 text-red-500 animate-pulse'
                          : pinDigits[i]
                            ? 'border-green-400 bg-green-50 text-green-700'
                            : 'border-gray-200 bg-gray-50 text-gray-300'
                      }`}
                    >
                      {pinDigits[i] ? '•' : ''}
                    </div>
                  ))}
                </div>

                {pinError && (
                  <p className="text-center text-[12px] text-red-500 font-medium mb-4">PIN incorrect. Réessayez.</p>
                )}

                {/* Numpad */}
                <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                  {numpadKeys.map((key, idx) => {
                    if (key === '') {
                      return <div key={idx} />;
                    }
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleNumpadPress(key)}
                        className={`w-full aspect-square rounded-2xl flex items-center justify-center text-xl font-bold transition-all active:scale-95 ${
                          key === '⌫'
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            : 'bg-gray-50 text-gray-800 hover:bg-green-50 hover:text-green-700 border border-gray-100'
                        }`}
                        style={{ minHeight: '64px' }}
                      >
                        {key === '⌫' ? <ChevronLeft className="w-5 h-5" /> : key}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer bas */}
        <div className="px-10 py-5">
          <p className="text-[10.5px] text-gray-400 text-center">
            © {new Date().getFullYear()} Yaro FleetOS ·{" "}
            <span className="text-gray-500 font-medium">Transport ABOUBAKAR YARORO</span>
            {" "}· Douala, Cameroun
          </p>
        </div>
      </div>
    </div>
  );
}