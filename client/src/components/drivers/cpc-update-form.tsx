import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CPCUpdateFormProps {
  driverId: number;
  driverName: string;
  currentCPCDate?: string | null;
  currentStatus?: string;
}

export function CPCUpdateForm({ driverId, driverName, currentCPCDate, currentStatus }: CPCUpdateFormProps) {
  const [cpcDate, setCpcDate] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await apiRequest("POST", `/api/drivers/${driverId}/update-cpc`, {
        cpcDate: date,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/expiring-cpc"] });
      toast({
        title: "Formation CPC mise à jour",
        description: `La certification CPC de ${driverName} a été mise à jour avec succès.`,
      });
      setCpcDate("");
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de mettre à jour la formation CPC",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!cpcDate) {
      toast({
        title: "Date requise",
        description: "Veuillez sélectionner une date de formation",
        variant: "destructive",
      });
      return;
    }

    const selectedDate = new Date(cpcDate);
    const today = new Date();
    
    if (selectedDate > today) {
      toast({
        title: "Date invalide",
        description: "La date de formation ne peut pas être dans le futur",
        variant: "destructive",
      });
      return;
    }

    mutation.mutate(cpcDate);
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'FORMÉ':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'À FORMER':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'NON FORMÉ':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">👨‍🎓 Mise à jour Formation CPC</CardTitle>
        <CardDescription className="flex items-center gap-2 flex-wrap">
          <span>Chauffeur: <span className="font-semibold">{driverName}</span></span>
          {currentStatus && (
            <Badge className={getStatusColor(currentStatus)}>
              {currentStatus}
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {currentCPCDate && (
            <div className="bg-muted p-3 rounded-md">
              <p className="text-sm text-muted-foreground">
                Date de formation actuelle: <span className="font-semibold">{new Date(currentCPCDate).toLocaleDateString('fr-FR')}</span>
              </p>
            </div>
          )}

          <div>
            <Label htmlFor={`cpc-date-${driverId}`}>Date de la formation CPC</Label>
            <Input
              id={`cpc-date-${driverId}`}
              type="date"
              value={cpcDate}
              onChange={(e) => setCpcDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              required
              data-testid={`input-cpc-date-${driverId}`}
            />
            <p className="text-sm text-muted-foreground mt-1">
              La certification CPC est valable 731 jours (environ 2 ans)
            </p>
          </div>

          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full"
            data-testid={`btn-update-cpc-${driverId}`}
          >
            {mutation.isPending ? "Mise à jour..." : "Mettre à jour la formation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
