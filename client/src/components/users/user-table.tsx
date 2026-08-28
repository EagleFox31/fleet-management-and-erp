import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { UserForm } from "./user-form";
import { Badge } from "@/components/ui/badge";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "admin" | "workshop_manager" | "technician" | "client" | "user" | string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

interface UserTableProps {
  users: User[];
  isLoading: boolean;
}

export function UserTable({ users, isLoading }: UserTableProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // Mutation pour supprimer un utilisateur
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest("DELETE", `/api/users/${userId}`);
    },
    onSuccess: () => {
      toast({
        title: "Utilisateur supprimé",
        description: "L'utilisateur a été supprimé avec succès",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de la suppression de l'utilisateur: ${error.message}`,
      });
    },
  });

  // Fonction pour ouvrir la boîte de dialogue de suppression
  const handleDeleteClick = (user: User) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  // Fonction pour ouvrir la boîte de dialogue d'édition
  const handleEditClick = (user: User) => {
    setSelectedUser(user);
    setIsEditDialogOpen(true);
  };

  // Fonction pour confirmer la suppression
  const confirmDelete = () => {
    if (selectedUser) {
      deleteUserMutation.mutate(selectedUser.id);
    }
  };

  const getRoleLabel = (role: string | undefined) => {
    if (!role) return "Utilisateur";
    
    switch (role) {
      case "admin":
        return "Administrateur";
      case "workshop_manager":
        return "Gestionnaire atelier";
      case "technician":
        return "Technicien";
      case "client":
        return "Client";
      case "user":
      default:
        return "Utilisateur";
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="py-3 px-4 text-left">Nom</th>
              <th className="py-3 px-4 text-left">Nom d'utilisateur</th>
              <th className="py-3 px-4 text-left">Email</th>
              <th className="py-3 px-4 text-left">Rôle</th>
              <th className="py-3 px-4 text-left">Dernière connexion</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  Aucun utilisateur trouvé
                </td>
              </tr>
            ) : (
              users.map((user) => {
                // Formater la date au format JJ-MM-YYYY hh:mm
                const formatCreatedDate = (dateString: string | Date | undefined) => {
                  if (!dateString) return "Non spécifié";
                  
                  const date = new Date(dateString);
                  const day = date.getDate().toString().padStart(2, '0');
                  const month = (date.getMonth() + 1).toString().padStart(2, '0');
                  const year = date.getFullYear();
                  const hours = date.getHours().toString().padStart(2, '0');
                  const minutes = date.getMinutes().toString().padStart(2, '0');
                  
                  return `${day}-${month}-${year} ${hours}:${minutes}`;
                };

                return (
                  <tr key={user.id} className="border-b">
                    <td className="py-3 px-4">{user.name}</td>
                    <td className="py-3 px-4">{user.username}</td>
                    <td className="py-3 px-4">{user.email}</td>
                    <td className="py-3 px-4">
                      <Badge 
                        variant={user.role === "admin" ? "default" : 
                               user.role === "workshop_manager" ? "secondary" : 
                               user.role === "technician" ? "outline" : 
                               user.role === "client" ? "destructive" : "secondary"}
                        className="font-normal"
                      >
                        {getRoleLabel(user.role)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {user.lastLoginAt ? formatCreatedDate(user.lastLoginAt) : "Jamais connecté"}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-2">
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="h-8 w-8 text-primary"
                        onClick={() => handleEditClick(user)}
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDeleteClick(user)}
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogue de confirmation de suppression */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-destructive mr-2" />
              Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer l'utilisateur{" "}
              <strong>{selectedUser?.name}</strong> ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-between">
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDelete}
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Suppression...
                </>
              ) : (
                "Confirmer la suppression"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue d'édition d'utilisateur */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
            <DialogDescription>
              Modifiez les informations de l'utilisateur
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {selectedUser && (
              <UserForm
                initialData={{
                  username: selectedUser.username,
                  name: selectedUser.name,
                  email: selectedUser.email,
                  role: (selectedUser.role as "admin" | "workshop_manager" | "technician" | "client" | "user"),
                  password: ""
                }}
                isEdit={true}
                userId={selectedUser.id}
                onSuccess={() => {
                  setIsEditDialogOpen(false);
                  queryClient.invalidateQueries({ queryKey: ["/api/users"] });
                  toast({
                    title: "Utilisateur mis à jour",
                    description: "L'utilisateur a été mis à jour avec succès",
                  });
                }}
                onCancel={() => setIsEditDialogOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
