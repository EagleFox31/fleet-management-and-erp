import { useState, useEffect, createContext, useContext, useRef, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, User, LoginCredentials } from "@/lib/auth";
import { checkSession, nextSessionRetryDelay } from "@/lib/session-check";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loginFailureOf } from "@/lib/lockout-message";
import { clientLogger } from "@/lib/logger";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  /** Message de la dernière connexion refusée par verrouillage (429), sinon null. */
  loginLockMessage: string | null;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticating: false,
  isAuthenticated: false,
  loginLockMessage: null,
  login: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // bootstrap auth check
  const [isAuthenticating, setIsAuthenticating] = useState(false); // login/logout actions
  const [loginLockMessage, setLoginLockMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const authCheckVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Vrai tant que /api/auth/me n'a pas répondu (délai, réseau, 5xx) : on réessaie au lieu
  // de traiter la lenteur comme une déconnexion. Seul un 401 renvoie vers la connexion.
  const [sessionUnreachable, setSessionUnreachable] = useState(false);
  const retryNowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const checkVersion = ++authCheckVersionRef.current;
    const isStale = () => !mountedRef.current || checkVersion !== authCheckVersionRef.current;

    const checkUser = async () => {
      setIsLoading(true);
      for (let attempt = 1; ; attempt++) {
        const result = await checkSession();
        if (isStale()) return;
        if (result.status !== "unreachable") {
          setUser(result.status === "authenticated" ? result.user : null);
          setSessionUnreachable(false);
          setIsLoading(false);
          return;
        }
        clientLogger.warn("Session check unreachable", { attempt });
        setSessionUnreachable(true);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, nextSessionRetryDelay(attempt));
          retryNowRef.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        retryNowRef.current = null;
        if (isStale()) return;
      }
    };

    checkUser();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<boolean> => {
    authCheckVersionRef.current += 1; // invalidate stale bootstrap check callbacks
    setSessionUnreachable(false);
    retryNowRef.current?.();
    try {
      if (isLoading) {
        setIsLoading(false);
      }
      setIsAuthenticating(true);
      setLoginLockMessage(null);
      const userData = await apiLogin(credentials);
      if (!mountedRef.current) {
        return false;
      }
      setUser(userData);
      toast({
        title: "Connexion réussie",
        description: `Bienvenue, ${userData.name}`,
      });
      return true;
    } catch (error) {
      clientLogger.error("Login error", { err: error });
      if (!mountedRef.current) {
        return false;
      }
      setUser(null);
      const failure = loginFailureOf(error);
      setLoginLockMessage(failure.kind === "locked" ? failure.message : null);
      toast({
        variant: "destructive",
        title: failure.kind === "locked" ? "Compte verrouillé" : "Échec de connexion",
        description: failure.message ?? "Connexion impossible. Vérifiez vos identifiants ou le réseau.",
      });
      return false;
    } finally {
      if (mountedRef.current) {
        setIsAuthenticating(false);
      }
    }
  };

  const logout = async (): Promise<void> => {
    authCheckVersionRef.current += 1;
    setSessionUnreachable(false);
    retryNowRef.current?.();
    try {
      setIsAuthenticating(true);
      await apiLogout();
      if (mountedRef.current) {
        toast({
          title: "Déconnexion réussie",
        });
      }
    } catch (error) {
      clientLogger.error("Logout error", { err: error });
      if (mountedRef.current) {
        toast({
          variant: "destructive",
          title: "Déconnexion locale appliquée",
          description: "Votre session locale est fermée. La déconnexion sera confirmée auprès du serveur dès que possible.",
        });
      }
    } finally {
      if (mountedRef.current) {
        setUser(null);
        setIsLoading(false);
        setIsAuthenticating(false);
      }
    }
  };

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticating,
    isAuthenticated: !!user,
    loginLockMessage,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {isLoading && sessionUnreachable ? <SessionUnreachableNotice onRetry={() => retryNowRef.current?.()} /> : null}
    </AuthContext.Provider>
  );
}

function SessionUnreachableNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      data-testid="session-unreachable"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
    >
      <div className="max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm space-y-3">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="font-medium text-foreground">Le serveur met du temps à répondre</p>
        <p className="text-sm text-muted-foreground">
          Votre session est conservée. Nouvelle tentative automatique en cours.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Réessayer maintenant
        </button>
      </div>
    </div>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
