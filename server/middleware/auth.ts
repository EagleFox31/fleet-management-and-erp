import { Request, Response, NextFunction } from 'express';
import { storage } from "../storage";
import { moduleLogger } from "../lib/logger";
import { ALL_APP_ROLES, STAFF_ROLES, type AppRole } from "@shared/constants/roles";

const ALL_ROLES = ALL_APP_ROLES;

const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  administrateur: "admin",
  workshop_manager: "workshop_manager",
  gestionnaire_atelier: "workshop_manager",
  "gestionnaire d'atelier": "workshop_manager",
  technician: "technician",
  technicien: "technician",
  secretary: "secretary",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logistics: "logistics",
  logisticien: "logistics",
  warehouse: "warehouse",
  magasinier: "warehouse",
  management: "management",
  direction: "management",
  directeur: "management",
  dg: "management",
  client: "client",
  user: "user",
};

export const normalizeRole = (role: string | null | undefined): AppRole => {
  const normalized = (role || "").trim().toLowerCase();
  const aliasRole = ROLE_ALIASES[normalized];
  if (aliasRole) {
    return aliasRole;
  }

  if ((ALL_ROLES as readonly string[]).includes(normalized)) {
    return normalized as AppRole;
  }

  return "user";
};

/**
 * Marque un middleware qui refuse toute requête sans session (401).
 * Le test de contrat `api-auth-guard` parcourt les routes et exige qu'une garde
 * marquée précède chacune d'elles, hors liste blanche des routes publiques.
 */
const SESSION_GUARD = Symbol.for("fleetos.sessionGuard");

export function sessionGuard<T extends Function>(fn: T): T {
  (fn as unknown as Record<symbol, boolean>)[SESSION_GUARD] = true;
  return fn;
}

export function isSessionGuard(fn: unknown): boolean {
  return typeof fn === "function" && (fn as unknown as Record<symbol, boolean>)[SESSION_GUARD] === true;
}

export const authenticate = sessionGuard(async (req: Request, res: Response, next: NextFunction) => {
  const debugAuth = process.env.AUTH_DEBUG !== "0";
  if (debugAuth) {
    console.log(`🔐 [AUTH] ${req.method} ${req.path} - Session: ${!!req.session} - UserId: ${req.session?.userId || 'NONE'}`);
  }

  if (!req.session || !req.session.userId) {
    if (debugAuth) {
      console.log(`❌ [AUTH] Accès refusé - Non authentifié`);
    }
    return res.status(401).json({ message: 'Non authentifié' });
  }

  // Le compte est relu : une session survivante d'un compte supprimé ou
  // inexistant ne passe plus, même sur une route gardée par `authenticate` seul.
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user || user.deletedAt) {
      if (debugAuth) {
        console.log(`❌ [AUTH] Accès refusé - Compte supprimé ou inconnu: ${req.session.userId}`);
      }
      return res.status(401).json({ message: 'Non authentifié' });
    }
  } catch (err) {
    moduleLogger("auth").error({ err, requestId: req.requestId }, "Relecture du compte impossible");
    return res.status(500).json({ message: 'Erreur serveur' });
  }

  if (debugAuth) {
    console.log(`✅ [AUTH] Accès autorisé - UserId: ${req.session.userId}`);
  }
  next();
});

export const authorize = (roles: string[]) => {
  return sessionGuard(async (req: Request, res: Response, next: NextFunction) => {
    const debugAuth = process.env.AUTH_DEBUG !== "0";
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: 'Non authentifié' });
    }
    
    try {
      const user = await storage.getUser(req.session.userId);
      
      // Un compte supprimé ou désactivé n'a plus de session valide.
      if (!user || user.deletedAt) {
        return res.status(401).json({ message: 'Utilisateur non trouvé' });
      }

      const normalizedUserRole = normalizeRole(user.role);
      const normalizedAllowedRoles = roles.map(normalizeRole);

      if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
        if (debugAuth) {
          console.log(
            `❌ [AUTH] Accès refusé - Rôle utilisateur: "${user.role}" (${normalizedUserRole}), rôles autorisés: ${normalizedAllowedRoles.join(", ")}`
          );
        }
        return res.status(403).json({ message: 'Accès non autorisé' });
      }

      if (debugAuth) {
        console.log(
          `✅ [AUTH] Accès autorisé - Rôle utilisateur: "${user.role}" (${normalizedUserRole}), rôles autorisés: ${normalizedAllowedRoles.join(", ")}`
        );
      }
      
      // Attach user to request
      req.user = {
        id: user.id,
        username: user.username,
        role: normalizedUserRole
      };
      
      next();
    } catch (error) {
      console.error('Error in authorization middleware:', error);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
  });
};

// Middleware spécifique pour les administrateurs uniquement
export const isAdmin = sessionGuard(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  
  try {
    const user = await storage.getUser(req.session.userId);
    
    // Un compte supprimé ou désactivé n'a plus de session valide.
    if (!user || user.deletedAt) {
      return res.status(401).json({ message: 'Utilisateur non trouvé' });
    }
    
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Accès réservé aux administrateurs uniquement' });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    
    next();
  } catch (error) {
    console.error('Error in admin authorization middleware:', error);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

export const isWorkshopManager = authorize(['admin', 'workshop_manager']);
export const isTechnician = authorize(['admin', 'workshop_manager', 'technician']);
export const isInventoryManager = authorize(['admin', 'workshop_manager', 'warehouse', 'secretary']);
// Référentiel pièces (création/modification de la fiche): moindre privilège.
// Le chef d'atelier et la secrétaire n'ont rien à modifier sur une fiche pièce;
// ils restent couverts par `isInventoryManager` pour le workflow des demandes.
// Porte d'entrée de la sortie de stock. Le droit réel est tranché plus bas,
// dans le service: le magasin sort de plein droit, le chef d'atelier
// uniquement en dérogation motivée (magasin fermé). Le technicien n'entre
// pas — il demande la pièce, il ne se sert pas lui-même.
export const isStockIssuer = authorize(['admin', 'warehouse', 'workshop_manager']);

export const isPartsCatalogManager = authorize(['admin', 'warehouse']);
// Catalogue pneus = stock magasin (réception fournisseur, quantités, emplacement).
// La feuille Excel PNEUMATIQUE mélange deux métiers: les colonnes d'entrée
// (Date_entree, Fournisseur, N_fac_bl, Qte_entree) sont celles de la feuille
// STOCK, donc du magasin; les colonnes de sortie (Immatriculation, Position,
// Km_compteur) relèvent de l'atelier.
// Le montage sur véhicule et les rotations restent sous `isWorkshopManager`,
// les inspections sous `isTechnician`.
export const isTireCatalogManager = authorize(['admin', 'warehouse']);
export const isPartRequester = authorize(['admin', 'workshop_manager', 'technician', 'warehouse']);
export const isDriverManager = authorize(['admin', 'logistics', 'secretary']);
export const isFuelCardManager = authorize(['admin', 'logistics', 'secretary']);
// Saisie d'un plein depuis l'écran carburant. Le technicien n'en saisit pas ; le
// chauffeur passe par sa mission (POST /api/missions/:id/fuel-records).
export const isFuelRecordWriter = authorize(['admin', 'workshop_manager', 'secretary', 'logistics']);
export const isManagementOrAdmin = authorize(['admin', 'management']);
// Toute session valide, avec `req.user` chargé (rôle normalisé) : pour les routes
// ouvertes à tous dont la réponse dépend du rôle (cloison client, server/lib/client-scope.ts).
export const isAnyUser = authorize([...ALL_ROLES]);
// Tout le personnel (tout rôle sauf `client`) : écritures faites par l'exploitation
// sur un véhicule, qu'un client consulte sans les saisir (kilométrage, position).
export const isStaff = authorize([...STAFF_ROLES]);
