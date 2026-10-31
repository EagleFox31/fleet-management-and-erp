import { useState, useEffect, createContext, useContext, useRef, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, getCurrentUser, User, LoginCredentials } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { lockoutMessageOf } from "@/lib/lockout-message";

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
        console.warn("Auth bootstrap watchdog triggered: forcing unauthenticated state");
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
        console.error("Error checking authentication:", error);
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
      console.error("Login error:", error);
      if (!mountedRef.current) {
        return false;
      }
      setUser(null);
      const lockMessage = lockoutMessageOf(error);
      setLoginLockMessage(lockMessage);
      toast({
        variant: "destructive",
        title: lockMessage ? "Compte verrouillé" : "Échec de connexion",
        description: lockMessage ?? "Connexion impossible. Vérifiez vos identifiants ou le réseau.",
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
      console.error("Logout error:", error);
      if (mountedRef.current) {
        toast({
          variant: "destructive",
          title: "Déconnexion locale appliquée",
          description: "Le serveur a renvoyé une erreur, mais votre session locale a été fermée.",
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
