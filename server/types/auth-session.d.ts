import "express-session";

type AppRole =
  | "admin"
  | "workshop_manager"
  | "technician"
  | "user"
  | "secretary"
  | "warehouse"
  | "logistics"
  | "client"
  | "driver";

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
