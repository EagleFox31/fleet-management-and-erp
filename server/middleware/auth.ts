import { Request, Response, NextFunction } from 'express';
import { storage } from "../storage";
import { ALL_APP_ROLES, type AppRole } from "@shared/constants/roles";

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

const normalizeRole = (role: string | null | undefined): AppRole => {
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

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
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

  if (debugAuth) {
    console.log(`✅ [AUTH] Accès autorisé - UserId: ${req.session.userId}`);
  }
  next();
};

export const authorize = (roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const debugAuth = process.env.AUTH_DEBUG !== "0";
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: 'Non authentifié' });
    }
    
    try {
      const user = await storage.getUser(req.session.userId);
      
      if (!user) {
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
  };
};

// Middleware spécifique pour les administrateurs uniquement
export const isAdmin = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Non authentifié' });
  }
  
  try {
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
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
};

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
export const isManagementOrAdmin = authorize(['admin', 'management']);
