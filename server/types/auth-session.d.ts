import "express-session";
import type { AppRole } from "@shared/constants/roles";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    role?: AppRole;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: AppRole;
      };
    }
  }
}

export {};
