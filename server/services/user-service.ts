import { db } from "../db";
import { users, type User, type InsertUser } from "@shared/schema";
import { eq, ilike, or, and, count, desc, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";

export class UserService {
  /**
   * Récupère tous les utilisateurs avec pagination et recherche
   */
  async getUsers(
    search?: string,
    role?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ users: User[], total: number }> {
    try {
      const conditions = [isNull(users.deletedAt)];

      if (search) {
        conditions.push(
          or(
            ilike(users.username, `%${search}%`),
            ilike(users.email, `%${search}%`),
            ilike(users.name, `%${search}%`)
          )!
        );
      }

      if (role) {
        conditions.push(eq(users.role, role as any));
      }

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      const [{ count: totalCount }] = await db
        .select({ count: count() })
        .from(users)
        .where(whereClause);

      const usersList = await db
        .select()
        .from(users)
        .where(whereClause)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        users: usersList,
        total: totalCount
      };
    } catch (error) {
      console.error('Error getting users:', error);
      return { users: [], total: 0 };
    }
  }

  /**
   * Récupère un utilisateur par ID
   */
  async getUserById(id: number): Promise<User | null> {
    try {
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, id));

      return user || null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      return null;
    }
  }

  /**
   * Récupère un utilisateur par nom d'utilisateur
   */
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const [user] = await db.select()
        .from(users)
        .where(eq(users.username, username));

      return user || null;
    } catch (error) {
      console.error('Error getting user by username:', error);
      return null;
    }
  }

  /**
   * Récupère un utilisateur par email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const [user] = await db.select()
        .from(users)
        .where(eq(users.email, email));

      return user || null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      return null;
    }
  }

  /**
   * Crée un nouveau compte utilisateur
   */
  async createUser(data: {
    username: string;
    email: string;
    password: string;
    name: string;
    role: 'admin' | 'workshop_manager' | 'technician' | 'client';
  }): Promise<User | null> {
    try {
      // Vérifier si l'utilisateur existe déjà
      const existingUser = await this.getUserByUsername(data.username);
      if (existingUser) {
        throw new Error('Un utilisateur avec ce nom existe déjà');
      }

      const existingEmail = await this.getUserByEmail(data.email);
      if (existingEmail) {
        throw new Error('Un utilisateur avec cet email existe déjà');
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(data.password, 10);

      const userData: InsertUser = {
        username: data.username,
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: data.role,
      };

      const [user] = await db.insert(users)
        .values(userData)
        .returning();

      console.log('User created:', { id: user.id, username: user.username, role: user.role });
      
      // Retourner l'utilisateur sans le mot de passe
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Error creating user:', error);
      return null;
    }
  }

  /**
   * Met à jour un utilisateur
   */
  async updateUser(id: number, data: {
    username?: string;
    email?: string;
    name?: string;
    role?: 'admin' | 'workshop_manager' | 'technician' | 'client';
  }): Promise<User | null> {
    try {
      // Vérifier les conflits si username ou email sont modifiés
      if (data.username) {
        const existingUser = await this.getUserByUsername(data.username);
        if (existingUser && existingUser.id !== id) {
          throw new Error('Un utilisateur avec ce nom existe déjà');
        }
      }

      if (data.email) {
        const existingEmail = await this.getUserByEmail(data.email);
        if (existingEmail && existingEmail.id !== id) {
          throw new Error('Un utilisateur avec cet email existe déjà');
        }
      }

      const [user] = await db.update(users)
        .set(data)
        .where(eq(users.id, id))
        .returning();

      console.log('User updated:', { id: user.id, username: user.username });
      
      // Retourner l'utilisateur sans le mot de passe
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Error updating user:', error);
      return null;
    }
  }

  /**
   * Change le mot de passe d'un utilisateur
   */
  async changePassword(id: number, newPassword: string): Promise<boolean> {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, id));

      console.log('Password changed for user:', id);
      return true;
    } catch (error) {
      console.error('Error changing password:', error);
      return false;
    }
  }

  /**
   * Active ou désactive un utilisateur
   */
  async toggleUserStatus(id: number, isActive: boolean): Promise<User | null> {
    try {
      const [user] = await db.update(users)
        .set({ deletedAt: isActive ? null : new Date() })
        .where(eq(users.id, id))
        .returning();

      console.log('User status toggled:', { id: user.id, isActive });
      
      // Retourner l'utilisateur sans le mot de passe
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Error toggling user status:', error);
      return null;
    }
  }

  /**
   * Supprime un utilisateur (soft delete - désactive l'utilisateur)
   */
  async deleteUser(id: number): Promise<boolean> {
    try {
      // Soft delete - désactiver l'utilisateur au lieu de le supprimer
      await db.update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, id));

      console.log('User soft deleted (deactivated):', id);
      return true;
    } catch (error) {
      console.error('Error deleting user:', error);
      return false;
    }
  }

  /**
   * Suppression physique d'un utilisateur (à utiliser avec précaution)
   */
  async hardDeleteUser(id: number): Promise<boolean> {
    try {
      await db.delete(users)
        .where(eq(users.id, id));

      console.log('User permanently deleted:', id);
      return true;
    } catch (error) {
      console.error('Error permanently deleting user:', error);
      return false;
    }
  }

  /**
   * Met à jour la date de dernière connexion
   */
  async updateLastLogin(id: number): Promise<void> {
    try {
      const user = await this.getUserById(id);
      const nextLoginCount = Number(user?.loginCount ?? 0) + 1;

      await db
        .update(users)
        .set({ lastLoginAt: new Date(), loginCount: nextLoginCount })
        .where(eq(users.id, id));
    } catch (error) {
      console.error('Error updating last login:', error);
    }
  }

  /**
   * Récupère les statistiques des utilisateurs
   */
  async getUserStatistics(): Promise<{
    totalUsers: number;
    activeUsers: number;
    usersByRole: Record<string, number>;
  }> {
    try {
      // Total des utilisateurs
      const [{ count: totalUsers }] = await db.select({ count: count() })
        .from(users);

      // Utilisateurs actifs
      const [{ count: activeUsers }] = await db.select({ count: count() })
        .from(users)
        .where(isNull(users.deletedAt));

      // Utilisateurs par rôle
      const roleStats = await db.select({
        role: users.role,
        count: count()
      })
      .from(users)
      .groupBy(users.role);

      const usersByRole = roleStats.reduce((acc, stat) => {
        acc[stat.role] = stat.count;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalUsers,
        activeUsers,
        usersByRole
      };
    } catch (error) {
      console.error('Error getting user statistics:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        usersByRole: {}
      };
    }
  }

  /**
   * Valide les données d'un utilisateur
   */
  validateUserData(data: any, isUpdate: boolean = false): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!isUpdate || data.username) {
      if (!data.username || typeof data.username !== 'string' || data.username.length < 3) {
        errors.push('Nom d\'utilisateur requis (minimum 3 caractères)');
      }
    }

    if (!isUpdate || data.email) {
      if (!data.email || typeof data.email !== 'string' || !data.email.includes('@')) {
        errors.push('Email valide requis');
      }
    }

    if (!isUpdate && (!data.password || typeof data.password !== 'string' || data.password.length < 6)) {
      errors.push('Mot de passe requis (minimum 6 caractères)');
    }

    if (!isUpdate || data.name) {
      if (!data.name || typeof data.name !== 'string' || data.name.length < 2) {
        errors.push('Nom requis (minimum 2 caractères)');
      }
    }

    if (!isUpdate || data.role) {
      const validRoles = ['admin', 'workshop_manager', 'technician', 'client'];
      if (!data.role || !validRoles.includes(data.role)) {
        errors.push('Rôle valide requis');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Authentifie un utilisateur
   */
  async authenticateUser(username: string, password: string): Promise<User | null> {
    try {
      const user = await this.getUserByUsername(username);
      if (!user || user.deletedAt) {
        return null;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return null;
      }

      // Mettre à jour la dernière connexion
      await this.updateLastLogin(user.id);

      // Retourner l'utilisateur sans le mot de passe
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Error authenticating user:', error);
      return null;
    }
  }
}

// Instance singleton
export const userService = new UserService();
