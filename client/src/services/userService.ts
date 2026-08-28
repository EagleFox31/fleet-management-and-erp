
import { apiRequest } from "@/lib/queryClient";

export const UserService = {
  async fetchUsers() {
    return await apiRequest("GET", "/api/users");
  },
  
  async addUser(userData: any) {
    // S'assurer que les données sont propres avant l'envoi
    const cleanData = { ...userData };
    
    // Supprimer updatedAt si présent
    if ('updatedAt' in cleanData) {
      delete cleanData.updatedAt;
    }
    
    return await apiRequest("POST", "/api/users", cleanData);
  },
  
  async updateUser(userData: any) {
    // Préparer les données à envoyer
    const cleanData = { ...userData };
    
    // Supprimer updatedAt car cette colonne n'existe pas dans la BDD
    if ('updatedAt' in cleanData) {
      delete cleanData.updatedAt;
    }
    
    // Retirer le mot de passe s'il est vide
    if (!cleanData.password || cleanData.password.trim() === '') {
      delete cleanData.password;
    }
    
    return await apiRequest("PATCH", `/api/users/${userData.id}`, cleanData);
  },
  
  async deleteUser(userId: number) {
    return await apiRequest("DELETE", `/api/users/${userId}`);
  }
};
