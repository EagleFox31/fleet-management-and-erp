import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { suggestUsernameFromFullName } from "@/lib/username-suggestion";

const userRoles = [
  "admin",
  "management",
  "workshop_manager",
  "technician",
  "secretary",
  "logistics",
  "warehouse",
  "client",
  "driver",
  "user",
] as const;

type UserRole = (typeof userRoles)[number];

// Schéma de validation pour le formulaire utilisateur
const userFormSchema = z.object({
  username: z.string().min(3, "Le nom d'utilisateur doit avoir au moins 3 caractères"),
  password: z.string().min(6, "Le mot de passe doit avoir au moins 6 caractères"),
  email: z.string().email("Email invalide"),
  name: z.string().min(2, "Le nom doit avoir au moins 2 caractères"),
  role: z.enum(userRoles),
});

// En édition, un mot de passe vide signifie « ne pas le changer » : `partial()`
// laisserait `min(6)` rejeter la chaîne vide.
const passwordWhenEditing = userFormSchema.shape.password.optional().or(z.literal(""));

// Type pour les valeurs du formulaire
type UserFormValues = z.infer<typeof userFormSchema>;

// Props pour le composant UserForm
interface UserFormProps {
  initialData?: Partial<UserFormValues>;
  isEdit?: boolean;
  userId?: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function UserForm({ initialData, isEdit = false, userId, onSuccess, onCancel }: UserFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [usernameAutoSync, setUsernameAutoSync] = useState(!isEdit);

  // Configuration du formulaire avec react-hook-form et zod
  const form = useForm<UserFormValues>({
    resolver: zodResolver(
      isEdit 
        ? userFormSchema.extend({ password: passwordWhenEditing }) // Mot de passe optionnel en mode édition
        : userFormSchema
    ),
    defaultValues: {
      username: initialData?.username || "",
      password: initialData?.password || "",
      email: initialData?.email || "",
      name: initialData?.name || "",
      role: (initialData?.role as UserRole | undefined) || "user",
    },
  });

  const watchedName = form.watch("name");
  const watchedUsername = form.watch("username");
  const suggestedUsername = suggestUsernameFromFullName(watchedName);
  const showsUsernameSuggestion =
    !isEdit &&
    usernameAutoSync &&
    suggestedUsername.length > 0 &&
    watchedUsername === suggestedUsername;

  // Mutation pour créer ou mettre à jour un utilisateur
  const queryClient = useQueryClient();
  
  const userMutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      return await apiRequest(
        isEdit ? "PATCH" : "POST",
        isEdit ? `/api/users/${userId}` : "/api/users",
        values
      );
    },
    onSuccess: () => {
      // Invalider la requête pour forcer le rechargement des utilisateurs
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });

      toast({
        title: isEdit ? "Utilisateur mis à jour" : "Utilisateur créé",
        description: isEdit
          ? "L'utilisateur a été mis à jour avec succès"
          : "L'utilisateur a été créé avec succès",
      });
      
      if (onSuccess) {
        onSuccess();
      }
      form.reset();
      setUsernameAutoSync(true);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, `Erreur lors de ${isEdit ? "la mise à jour" : "la création"} de l'utilisateur`),
      });
    },
  });

  // Fonction de soumission du formulaire
  function onSubmit(values: UserFormValues) {
    // Si nous sommes en mode édition et que le mot de passe est vide, le supprimer
    if (isEdit && !values.password) {
      const { password, ...rest } = values;
      setIsLoading(true);
      userMutation.mutate(rest as UserFormValues, {
        onSettled: () => {
          setIsLoading(false);
        },
      });
    } else {
      setIsLoading(true);
      userMutation.mutate(values, {
        onSettled: () => {
          setIsLoading(false);
        },
      });
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom complet</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Jean Dupont"
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
                          if (!isEdit && usernameAutoSync) {
                            form.setValue(
                              "username",
                              suggestUsernameFromFullName(event.target.value),
                              { shouldValidate: true },
                            );
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom d'utilisateur</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="jdupont"
                        {...field}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          field.onChange(event);

                          if (isEdit) {
                            return;
                          }

                          if (nextValue === "") {
                            setUsernameAutoSync(true);
                            return;
                          }

                          const suggestion = suggestUsernameFromFullName(form.getValues("name"));
                          if (nextValue !== suggestion) {
                            setUsernameAutoSync(false);
                          }
                        }}
                      />
                    </FormControl>
                    {showsUsernameSuggestion ? (
                      <FormDescription>
                        Proposé automatiquement — cliquez pour personnaliser
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="jean.dupont@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rôle</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un rôle" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Administrateur</SelectItem>
                        <SelectItem value="management">Direction (DG)</SelectItem>
                        <SelectItem value="workshop_manager">Gestionnaire atelier</SelectItem>
                        <SelectItem value="technician">Technicien</SelectItem>
                        <SelectItem value="secretary">Secrétaire</SelectItem>
                        <SelectItem value="logistics">Logistique</SelectItem>
                        <SelectItem value="warehouse">Magasinier</SelectItem>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="driver">Chauffeur</SelectItem>
                        <SelectItem value="user">Utilisateur standard</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className={isEdit ? "col-span-2" : ""}>
                    <FormLabel>{isEdit ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe"}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                    Traitement...
                  </>
                ) : isEdit ? (
                  "Mettre à jour"
                ) : (
                  "Créer"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
