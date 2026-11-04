import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Helmet } from "react-helmet";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserTable } from "@/components/users/user-table";
import { UserForm } from "@/components/users/user-form";
import { Plus, UserCog } from "lucide-react";

// Interface pour les utilisateurs
interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
}

export default function UsersPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  // Requête pour obtenir la liste des utilisateurs
  const { data: users, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/users"],
    refetchInterval: false,
    retry: 1,
    staleTime: 5000
  });

  return (
    <>
      <Helmet>
        <title>Gestion des utilisateurs | Yaro FleetOS</title>
        <meta name="description" content="Gérez les comptes utilisateurs, leurs rôles et leurs permissions." />
      </Helmet>
      
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Gestion des utilisateurs</h1>
            <p className="text-muted-foreground mt-1">
              Gérez les comptes utilisateurs, leurs rôles et leurs permissions.
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un utilisateur
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center text-xl">
              <UserCog className="mr-2 h-5 w-5" />
              Liste des utilisateurs
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <UserTable 
              users={Array.isArray(users) ? users : []} 
              isLoading={isLoading} 
            />
          </CardContent>
        </Card>
      </div>

      {/* Dialogue pour ajouter un utilisateur */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Ajouter un utilisateur</DialogTitle>
            <DialogDescription>
              Créez un nouvel utilisateur dans le système. Vous pourrez définir son nom, rôle et autres informations.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <UserForm
              onSuccess={() => {
                setIsAddDialogOpen(false);
                refetch(); // Force le rafraîchissement de la liste
                toast({
                  title: "Utilisateur créé",
                  description: "Le nouvel utilisateur a été créé avec succès",
                });
              }}
              onCancel={() => setIsAddDialogOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}