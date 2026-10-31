import { useState, useEffect, createContext, useContext, useRef, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, getCurrentUser, User, LoginCredentials } from "@/lib/auth";
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
  /** Vrai quand le serveur a exigé la preuve captcha à la dernière tentative (400 sur `captcha`). */
  loginCaptchaRequired: boolean;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticating: false,
  isAuthenticated: false,
  loginLockMessage: null,
  loginCaptchaRequired: false,
  login: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // bootstrap auth check
  const [isAuthenticating, setIsAuthenticating] = useState(false); // login/logout actions
  const [loginLockMessage, setLoginLockMessage] = useState<string | null>(null);
  const [loginCaptchaRequired, setLoginCaptchaRequired] = useState(false);
  const { toast } = useToast();
  const authCheckVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const checkUser = async () => {
      const checkVersion = ++authCheckVersionRef.current;
      const watchdog = setTimeout(() => {
        if (!mountedRef.current || checkVersion !== authCheckVersionRef.current) {
          return;
        }
        clientLogger.warn("Auth bootstrap watchdog triggered: forcing unauthenticated state");
        setUser(null);
        setIsLoading(false);
      }, 12_000);

      try {
        setIsLoading(true);
        const userData = await getCurrentUser();
        if (!mountedRef.current || checkVersion !== authCheckVersionRef.current) {
          return;
        }
        setUser(userData);
      } catch (error) {
        clientLogger.error("Error checking authentication", { err: error });
        if (!mountedRef.current || checkVersion !== authCheckVersionRef.current) {
          return;
        }
        setUser(null);
      } finally {
        clearTimeout(watchdog);
        if (!mountedRef.current || checkVersion !== authCheckVersionRef.current) {
          return;
        }
        setIsLoading(false);
      }
    };

    checkUser();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<boolean> => {
    authCheckVersionRef.current += 1; // invalidate stale bootstrap check callbacks
    try {
      if (isLoading) {
        setIsLoading(false);
      }
      setIsAuthenticating(true);
      setLoginLockMessage(null);
      setLoginCaptchaRequired(false);
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
      setLoginCaptchaRequired(failure.kind === "captcha");
      toast({
        variant: "destructive",
        title: failure.kind === "locked" ? "Compte verrouillé" : failure.kind === "captcha" ? "Vérification requise" : "Échec de connexion",
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
    loginCaptchaRequired,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
