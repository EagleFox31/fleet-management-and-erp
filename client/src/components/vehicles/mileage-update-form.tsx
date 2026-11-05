import { userMessageOf } from "@/lib/api-error";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Route } from "lucide-react";

interface MileageUpdateFormProps {
  vehicleId: number;
  currentMileage?: number;
  registrationNumber: string;
}

export function MileageUpdateForm({ vehicleId, currentMileage, registrationNumber }: MileageUpdateFormProps) {
  const [kilometers, setKilometers] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (kilometers: number) => {
      const res = await apiRequest("PUT", `/api/vehicles/${vehicleId}/mileage`, {
        kilometers,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
      toast({
        title: "Kilométrage mis à jour",
        description: `Le kilométrage du véhicule ${registrationNumber} a été mis à jour avec succès.`,
      });
      setKilometers("");
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de mettre à jour le kilométrage"),
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newKilometers = parseInt(kilometers);
    
    if (isNaN(newKilometers) || newKilometers < 0) {
      toast({
        title: "Valeur invalide",
        description: "Veuillez entrer un kilométrage valide",
        variant: "destructive",
      });
      return;
    }

    if (currentMileage && newKilometers < currentMileage) {
      toast({
        title: "Valeur invalide",
        description: `Le nouveau kilométrage doit être supérieur au kilométrage actuel (${currentMileage} km)`,
        variant: "destructive",
      });
      return;
    }

    mutation.mutate(newKilometers);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg"><Route className="inline h-5 w-5 mr-2 align-text-bottom" aria-hidden />Mise à jour kilométrage</CardTitle>
        <CardDescription>
          Véhicule: <span className="font-semibold">{registrationNumber}</span>
          {currentMileage !== undefined && (
            <> • Kilométrage actuel: <span className="font-semibold">{currentMileage.toLocaleString()} km</span></>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor={`mileage-${vehicleId}`}>Nouveau kilométrage (km)</Label>
            <Input
              id={`mileage-${vehicleId}`}
              type="number"
              placeholder="Ex: 125000"
              value={kilometers}
              onChange={(e) => setKilometers(e.target.value)}
              min={currentMileage || 0}
              required
              data-testid={`input-mileage-${vehicleId}`}
            />
            {currentMileage !== undefined && (
              <p className="text-sm text-muted-foreground mt-1">
                Minimum: {currentMileage.toLocaleString()} km
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full"
            data-testid={`btn-update-mileage-${vehicleId}`}
          >
            {mutation.isPending ? "Mise à jour..." : "Mettre à jour"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
