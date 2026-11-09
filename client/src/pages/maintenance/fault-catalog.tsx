import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BookOpen, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle, 
  Clock, 
  FileText,
  Wrench,
  DollarSign,
  Users,
  Edit,
  Trash2
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { InlineQueryError } from "@/components/ui/inline-query-error";

interface FaultCatalog {
  id: number;
  name: string;
  description: string;
  category: string;
  vehicleBrand?: string;
  symptoms: string[];
  diagnosticSteps: string[];
  repairSteps: string[];
  estimatedDuration?: number;
  minimumCost?: number;
  maximumCost?: number;
  status: "draft" | "validated" | "archived";
  createdBy?: number;
  validatedBy?: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "Moteur",
  "Freins", 
  "Électrique",
  "Transmission",
  "Suspension",
  "Climatisation",
  "Carrosserie",
  "Pneumatiques",
  "Autre"
];

const VEHICLE_BRANDS = [
  "Toyota",
  "Nissan", 
  "Hyundai",
  "Kia",
  "Peugeot",
  "Renault",
  "Mercedes",
  "Autre"
];

export default function FaultCatalogPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FaultCatalog | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Formulaire pour nouvel élément
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    vehicleBrand: "",
    symptoms: [""],
    diagnosticSteps: [""],
    repairSteps: [""],
    estimatedDuration: "",
    minimumCost: "",
    maximumCost: ""
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/fault-catalog', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fault-catalog'] });
      toast({
        title: "Intervention créée",
        description: "L'intervention a été ajoutée au catalogue avec succès",
      });
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: "Impossible de créer l'intervention",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/fault-catalog/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fault-catalog'] });
      toast({
        title: "Intervention modifiée",
        description: "L'intervention a été mise à jour avec succès",
      });
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: "Impossible de modifier l'intervention",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/fault-catalog/${id}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fault-catalog'] });
      toast({
        title: "Intervention supprimée",
        description: "L'intervention a été supprimée du catalogue",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'intervention",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formData.name || !formData.category) {
      toast({
        title: "Champs requis",
        description: "Le nom et la catégorie sont obligatoires",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name: formData.name,
      description: formData.description,
      category: formData.category,
      vehicleBrand: formData.vehicleBrand || null,
      symptoms: formData.symptoms.filter(s => s.trim() !== ""),
      diagnosticSteps: formData.diagnosticSteps.filter(s => s.trim() !== ""),
      repairSteps: formData.repairSteps.filter(s => s.trim() !== ""),
      estimatedDuration: formData.estimatedDuration ? parseInt(formData.estimatedDuration) : null,
      minimumCost: formData.minimumCost ? parseFloat(formData.minimumCost) : null,
      maximumCost: formData.maximumCost ? parseFloat(formData.maximumCost) : null,
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item: FaultCatalog) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description,
      category: item.category,
      vehicleBrand: item.vehicleBrand || "",
      symptoms: item.symptoms.length > 0 ? item.symptoms : [""],
      diagnosticSteps: item.diagnosticSteps.length > 0 ? item.diagnosticSteps : [""],
      repairSteps: item.repairSteps.length > 0 ? item.repairSteps : [""],
      estimatedDuration: item.estimatedDuration?.toString() || "",
      minimumCost: item.minimumCost?.toString() || "",
      maximumCost: item.maximumCost?.toString() || "",
    });
    setIsCreateDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cette intervention ?")) {
      deleteMutation.mutate(id);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      category: "",
      vehicleBrand: "",
      symptoms: [""],
      diagnosticSteps: [""],
      repairSteps: [""],
      estimatedDuration: "",
      minimumCost: "",
      maximumCost: ""
    });
    setEditingItem(null);
  };

  // Chargement des données
  const { data: faultCatalog, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ['/api/fault-catalog'],
  });

  const catalogs = faultCatalog || [];

  // Filtrage
  const filteredCatalogs = catalogs.filter((item: FaultCatalog) => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = !selectedCategory || item.category === selectedCategory;
    const matchesStatus = !selectedStatus || item.status === selectedStatus;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'validated': return 'bg-green-500 text-white';
      case 'draft': return 'bg-yellow-500 text-white';
      case 'archived': return 'bg-gray-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'validated': return 'Validé';
      case 'draft': return 'Brouillon';
      case 'archived': return 'Archivé';
      default: return status;
    }
  };

  const addArrayItem = (field: 'symptoms' | 'diagnosticSteps' | 'repairSteps') => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], ""]
    }));
  };

  const updateArrayItem = (field: 'symptoms' | 'diagnosticSteps' | 'repairSteps', index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? value : item)
    }));
  };

  const removeArrayItem = (field: 'symptoms' | 'diagnosticSteps' | 'repairSteps', index: number) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Chargement...</div>;
  }

  if (isError) {
    return (
      <div className="container mx-auto py-6">
        <InlineQueryError error={error} fallback="Le catalogue d'interventions est momentanément indisponible." onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catalogue d'Interventions</h1>
          <p className="text-muted-foreground">
            Gérez les procédures standardisées de réparation et maintenance
          </p>
        </div>
        
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Nouvelle Intervention
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? "Modifier l'intervention" : "Nouvelle intervention"}
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom de l'intervention *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: Changement de plaquettes de frein"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="category">Catégorie *</Label>
                  <Select value={formData.category} onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une catégorie" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="vehicleBrand">Marque de véhicule</Label>
                  <Select value={formData.vehicleBrand} onValueChange={(value) => setFormData(prev => ({ ...prev, vehicleBrand: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Toutes marques" />
                    </SelectTrigger>
                    <SelectContent>
                      {VEHICLE_BRANDS.map(brand => (
                        <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="duration">Durée estimée (heures)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={formData.estimatedDuration}
                    onChange={(e) => setFormData(prev => ({ ...prev, estimatedDuration: e.target.value }))}
                    placeholder="2"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="minCost">Coût minimum (F CFA)</Label>
                  <Input
                    id="minCost"
                    type="number"
                    value={formData.minimumCost}
                    onChange={(e) => setFormData(prev => ({ ...prev, minimumCost: e.target.value }))}
                    placeholder="50000"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maxCost">Coût maximum (F CFA)</Label>
                  <Input
                    id="maxCost"
                    type="number"
                    value={formData.maximumCost}
                    onChange={(e) => setFormData(prev => ({ ...prev, maximumCost: e.target.value }))}
                    placeholder="100000"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Description détaillée de l'intervention..."
                  rows={3}
                />
              </div>

              <Tabs defaultValue="symptoms" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="symptoms">Symptômes</TabsTrigger>
                  <TabsTrigger value="diagnostic">Diagnostic</TabsTrigger>
                  <TabsTrigger value="repair">Réparation</TabsTrigger>
                </TabsList>
                
                <TabsContent value="symptoms" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label>Symptômes observés</Label>
                    <Button size="sm" variant="outline" onClick={() => addArrayItem('symptoms')}>
                      <Plus className="w-4 h-4 mr-1" />
                      Ajouter
                    </Button>
                  </div>
                  {formData.symptoms.map((symptom, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={symptom}
                        onChange={(e) => updateArrayItem('symptoms', index, e.target.value)}
                        placeholder="Ex: Bruit de grincement lors du freinage"
                      />
                      {formData.symptoms.length > 1 && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => removeArrayItem('symptoms', index)}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  ))}
                </TabsContent>
                
                <TabsContent value="diagnostic" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label>Étapes de diagnostic</Label>
                    <Button size="sm" variant="outline" onClick={() => addArrayItem('diagnosticSteps')}>
                      <Plus className="w-4 h-4 mr-1" />
                      Ajouter
                    </Button>
                  </div>
                  {formData.diagnosticSteps.map((step, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={step}
                        onChange={(e) => updateArrayItem('diagnosticSteps', index, e.target.value)}
                        placeholder="Ex: Vérifier l'épaisseur des plaquettes"
                      />
                      {formData.diagnosticSteps.length > 1 && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => removeArrayItem('diagnosticSteps', index)}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  ))}
                </TabsContent>
                
                <TabsContent value="repair" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label>Étapes de réparation</Label>
                    <Button size="sm" variant="outline" onClick={() => addArrayItem('repairSteps')}>
                      <Plus className="w-4 h-4 mr-1" />
                      Ajouter
                    </Button>
                  </div>
                  {formData.repairSteps.map((step, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={step}
                        onChange={(e) => updateArrayItem('repairSteps', index, e.target.value)}
                        placeholder="Ex: Démonter les anciennes plaquettes"
                      />
                      {formData.repairSteps.length > 1 && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => removeArrayItem('repairSteps', index)}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  ))}
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => { setIsCreateDialogOpen(false); resetForm(); }}>
                  Annuler
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && "Enregistrement..."}
                  {!(createMutation.isPending || updateMutation.isPending) && (editingItem ? "Mettre à jour" : "Créer")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <BookOpen className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{catalogs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Validées</p>
                <p className="text-2xl font-bold">
                  {catalogs.filter((c: FaultCatalog) => c.status === 'validated').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Brouillons</p>
                <p className="text-2xl font-bold">
                  {catalogs.filter((c: FaultCatalog) => c.status === 'draft').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <Wrench className="h-8 w-8 text-purple-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Catégories</p>
                <p className="text-2xl font-bold">{CATEGORIES.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher une intervention..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Toutes catégories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Tous statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="validated">Validé</SelectItem>
                <SelectItem value="draft">Brouillon</SelectItem>
                <SelectItem value="archived">Archivé</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Liste des interventions */}
      <Card>
        <CardHeader>
          <CardTitle>Interventions ({filteredCatalogs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredCatalogs.length === 0 ? (
            <div className="text-center py-8">
              <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-2 text-sm font-semibold text-muted-foreground">Aucune intervention</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Commencez par créer votre première intervention standardisée.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Marque</TableHead>
                  <TableHead>Durée</TableHead>
                  <TableHead>Coût estimé</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCatalogs.map((item: FaultCatalog) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.category}</Badge>
                    </TableCell>
                    <TableCell>{item.vehicleBrand || "Toutes"}</TableCell>
                    <TableCell>
                      {item.estimatedDuration ? `${item.estimatedDuration}h` : "-"}
                    </TableCell>
                    <TableCell>
                      {item.minimumCost && item.maximumCost ? 
                        `${formatCurrency(item.minimumCost)} - ${formatCurrency(item.maximumCost)}` :
                        "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(item.status)}>
                        {getStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleEdit(item)}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Modifier
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleDelete(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Supprimer
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}