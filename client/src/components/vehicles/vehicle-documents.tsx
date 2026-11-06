import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { uploadFile } from "@/lib/api";
import { invalidateVehicleDocumentQueries } from "@/lib/vehicle-document-cache";
import { userMessageOf } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { useVehicleDocumentTypes } from "@/hooks/use-vehicle-document-types";
import { proposeDueDate } from "@/lib/document-due-date";
import { AlertCircle, Download, File, FilePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";

// Types
interface VehicleDocument {
  id: number;
  vehicleId: number;
  name: string;
  type: 'carte_grise' | 'assurance' | 'visite_technique' | 'taxe' | 'autre';
  description: string | null;
  filename: string;
  filesize: number;
  fileType: string;
  filePath: string;
  uploadedBy: number | null;
  uploadedByName?: string | null;
  updatedBy?: number | null;
  updatedByName?: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// Formatter utilitaires
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' octets';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
  else return (bytes / 1048576).toFixed(1) + ' Mo';
};

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'N/A';
  return format(new Date(dateString), 'dd MMM yyyy', { locale: fr });
};

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
}

const getUserName = (userId: number | null, usersList: User[]): string => {
  if (!userId) return 'Système';
  const user = usersList.find((entry) => entry.id === userId);
  if (user?.name) return user.name;
  return `Utilisateur #${userId}`;
};

const getDocumentTypeLabel = (type: string): string => {
  const types: Record<string, string> = {
    'carte_grise': 'Carte grise',
    'assurance': 'Assurance',
    'visite_technique': 'Visite technique',
    'taxe': 'Taxe',
    'autre': 'Autre'
  };
  return types[type] || type;
};

const RENEWABLE_DOCUMENT_TYPES: VehicleDocument["type"][] = [
  "carte_grise",
  "assurance",
  "visite_technique",
  "taxe",
];

const isRenewableDocumentType = (type: VehicleDocument["type"]): boolean =>
  RENEWABLE_DOCUMENT_TYPES.includes(type);

const isDocumentExpired = (expiryDate: string | null): boolean => {
  if (!expiryDate) return false;
  const date = new Date(expiryDate);
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

const getColorForDocumentType = (type: string): string => {
  const colorMap: Record<string, string> = {
    'carte_grise': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    'assurance': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    'visite_technique': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    'taxe': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    'autre': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
  };
  return colorMap[type] || colorMap['autre'];
};

interface VehicleDocumentsProps {
  vehicleId: number;
  /** Véhicule retiré : consultation et téléchargement seulement (le serveur refuse l'écriture en 409). */
  readOnly?: boolean;
}

export function VehicleDocuments({ vehicleId, readOnly = false }: VehicleDocumentsProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<VehicleDocument | null>(null);
  const canRequestRenewal = !readOnly && ["admin", "workshop_manager", "secretary", "logistics"].includes(user?.role || "");
  // Même garde que DELETE /api/documents/:id (isWorkshopManager).
  const canDeleteDocument = !readOnly && ["admin", "workshop_manager"].includes(user?.role || "");

  // Formulaire d'upload
  const [uploadForm, setUploadForm] = useState({
    name: '',
    type: '',
    description: '',
    expiryDate: '',
    file: null as File | null
  });
  // Referentiel des types (P-05) : repli sur la liste historique tant qu'il est vide ou indisponible.
  const { data: documentTypes } = useVehicleDocumentTypes({ activeOnly: true });
  // Libelles de tous les types (y compris desactives) pour la colonne Type.
  const { data: allDocumentTypes } = useVehicleDocumentTypes();
  const [proposedDate, setProposedDate] = useState<string | null>(null);
  
  // Récupérer les documents
  const { data: documents = [], isLoading, error } = useQuery<VehicleDocument[]>({
    queryKey: [`/api/vehicles/${vehicleId}/documents`],
    enabled: !!vehicleId,
    retry: false // Ne pas réessayer en cas d'erreur
  });
  
  // Récupérer la liste des utilisateurs pour afficher leurs noms
  const { data: usersData } = useQuery<User[] | { users: User[] }>({
    queryKey: ['/api/users'],
    enabled: !!vehicleId
  });
  const users = useMemo<User[]>(() => {
    if (Array.isArray(usersData)) return usersData;
    if (usersData && Array.isArray((usersData as any).users)) return (usersData as any).users;
    return [];
  }, [usersData]);

  // Mutation pour télécharger un document
  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const url = `/api/vehicles/${vehicleId}/documents`;
      return uploadFile(url, formData);
    },
    onSuccess: () => {
      toast({
        title: "Document téléchargé",
        description: "Le document a été téléchargé avec succès.",
      });
      setIsUploadDialogOpen(false);
      setUploadForm({
        name: '',
        type: '',
        description: '',
        expiryDate: '',
        file: null
      });
      // Documents + miroir vehicles.* (éligibilité mission) + écrans satellites.
      invalidateVehicleDocumentQueries(queryClient, vehicleId);
    },
    onError: (error: any) => {
      toast({
        title: "Erreur lors du téléchargement",
        description: userMessageOf(error, "Une erreur s'est produite. Veuillez réessayer."),
        variant: "destructive",
      });
    }
  });
  
  // Mutation pour supprimer un document
  const deleteMutation = useMutation({
    mutationFn: (documentId: number) => apiRequest("DELETE", `/api/documents/${documentId}`),
    onSuccess: () => {
      toast({
        title: "Document supprimé",
        description: "Le document a été supprimé avec succès.",
      });
      setIsDeleteDialogOpen(false);
      setSelectedDocument(null);
      // Invalider la requête pour recharger les documents
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}/documents`] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur lors de la suppression",
        description: userMessageOf(error, "Une erreur s'est produite. Veuillez réessayer."),
        variant: "destructive",
      });
    }
  });

  // Gérer le changement du fichier
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadForm({
        ...uploadForm,
        file: e.target.files[0]
      });
    }
  };
  
  // Gérer les changements de formulaire
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setUploadForm({
      ...uploadForm,
      [name]: value
    });
  };
  
  // Gérer la sélection du type
  const handleTypeChange = (value: string) => {
    // Echeance proposee seulement si le champ est vide ou porte encore une proposition precedente.
    const months = documentTypes?.find((t) => t.code === value)?.validityMonths;
    const proposal = proposeDueDate(new Date(), months);
    const canReplace = !uploadForm.expiryDate || uploadForm.expiryDate === proposedDate;
    if (canReplace) setProposedDate(proposal);
    setUploadForm({
      ...uploadForm,
      type: value,
      expiryDate: canReplace ? (proposal ?? "") : uploadForm.expiryDate,
    });
  };
  
  // Gérer l'upload d'un document
  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!uploadForm.file) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un fichier à télécharger.",
        variant: "destructive",
      });
      return;
    }
    
    if (!uploadForm.name || !uploadForm.type) {
      toast({
        title: "Erreur",
        description: "Le nom et le type du document sont obligatoires.",
        variant: "destructive",
      });
      return;
    }
    
    const formData = new FormData();
    formData.append('document', uploadForm.file);
    formData.append('name', uploadForm.name);
    formData.append('type', uploadForm.type);
    
    if (uploadForm.description) {
      formData.append('description', uploadForm.description);
    }
    
    if (uploadForm.expiryDate) {
      formData.append('expiryDate', uploadForm.expiryDate);
    }
    
    uploadMutation.mutate(formData);
  };
  
  // Gérer la suppression d'un document
  const submitDelete = useSingleFlightMutate(deleteMutation.mutate);
  const handleDelete = () => {
    if (selectedDocument) {
      submitDelete(selectedDocument.id);
    }
  };
  
  // Ouvrir la confirmation de suppression
  const openDeleteDialog = (document: VehicleDocument) => {
    setSelectedDocument(document);
    setIsDeleteDialogOpen(true);
  };
  
  // Télécharger un document
  const handleDownload = (documentId: number) => {
    // Servi en pièce jointe : le navigateur enregistre le fichier sans quitter la page
    window.location.assign(`/api/documents/${documentId}/download`);
  };

  const openRenewalDialog = (doc: VehicleDocument) => {
    if (!isRenewableDocumentType(doc.type)) {
      toast({
        title: "Type non pris en charge",
        description: "Le renouvellement est disponible pour carte grise, assurance, visite technique et taxe.",
        variant: "destructive",
      });
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const params = new URLSearchParams({
      source: "vehicle_detail",
      vehicleId: String(doc.vehicleId),
      documentId: String(doc.id),
      documentType: doc.type,
      returnTo,
    });
    setLocation(`/vehicles/documents/renew?${params.toString()}`);
  };

  const resolveUploadedByLabel = (doc: VehicleDocument) => {
    if (doc.uploadedByName && doc.uploadedByName.trim().length > 0) {
      return doc.uploadedByName;
    }
    return getUserName(doc.uploadedBy, users);
  };

  const resolveModifiedByLabel = (doc: VehicleDocument) => {
    if (!doc.updatedAt || doc.updatedAt === doc.createdAt) {
      return "—";
    }
    if (doc.updatedByName && doc.updatedByName.trim().length > 0) {
      return doc.updatedByName;
    }
    if (doc.updatedBy) {
      return getUserName(doc.updatedBy, users);
    }
    // updatedAt != createdAt mais updatedBy non tracé (données antérieures à la colonne)
    return "—";
  };

  const columns: PremiumDataTableColumn<VehicleDocument>[] = [
    {
      id: "name",
      header: "Nom",
      cell: (doc) => (
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{doc.name}</p>
          <p className="text-xs text-gray-400 truncate">{doc.filename}</p>
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      widthClassName: "w-[145px]",
      cell: (doc) => (
        <Badge variant="outline" className={getColorForDocumentType(doc.type)}>
          {allDocumentTypes?.find((t) => t.code === doc.type)?.label ?? getDocumentTypeLabel(doc.type)}
        </Badge>
      ),
    },
    {
      id: "size",
      header: "Taille",
      widthClassName: "w-[110px]",
      cell: (doc) => <span className="text-sm text-gray-600">{formatFileSize(doc.filesize)}</span>,
    },
    {
      id: "expiry",
      header: "Expiration",
      widthClassName: "w-[130px]",
      cell: (doc) => (
        <span className={`text-sm ${isDocumentExpired(doc.expiryDate) ? "text-red-700 font-semibold" : "text-gray-600"}`}>
          {doc.expiryDate ? formatDate(doc.expiryDate) : "N/A"}
        </span>
      ),
    },
    {
      id: "createdBy",
      header: "Ajouté par",
      widthClassName: "w-[140px]",
      cell: (doc) => <span className="text-sm text-gray-700">{resolveUploadedByLabel(doc)}</span>,
    },
    {
      id: "createdAt",
      header: "Ajouté le",
      widthClassName: "w-[130px]",
      cell: (doc) => <span className="text-sm text-gray-600">{formatDate(doc.createdAt)}</span>,
    },
    {
      id: "updatedBy",
      header: "Modifié par",
      widthClassName: "w-[140px]",
      cell: (doc) => <span className="text-sm text-gray-700">{resolveModifiedByLabel(doc)}</span>,
    },
    {
      id: "updatedAt",
      header: "Modifié le",
      widthClassName: "w-[130px]",
      cell: (doc) => <span className="text-sm text-gray-600">{formatDate(doc.updatedAt)}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[170px]",
      cell: (doc) => (
        <div className="flex items-center justify-end gap-1">
          {canRequestRenewal && isRenewableDocumentType(doc.type) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openRenewalDialog(doc)}
              title="Demander renouvellement"
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDownload(doc.id)}
            title="Télécharger"
            className="h-8 w-8"
          >
            <Download className="h-4 w-4" />
          </Button>
          {canDeleteDocument && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openDeleteDialog(doc)}
              title="Supprimer"
              aria-label="Supprimer le document"
              className="h-8 w-8"
            >
              <Trash2 className="h-4 w-4 text-destructive-text" />
            </Button>
          )}
        </div>
      ),
    },
  ];
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Documents du véhicule</CardTitle>
          <CardDescription>
            Gérez les documents administratifs et techniques du véhicule
          </CardDescription>
        </div>
        {!readOnly && (
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <FilePlus className="mr-2 h-4 w-4" />
              Ajouter un document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un document</DialogTitle>
              <DialogDescription>
                Téléchargez un document pour ce véhicule. Les formats supportés sont PDF, images, Word et Excel.
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleUpload}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Nom
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    value={uploadForm.name}
                    onChange={handleInputChange}
                    className="col-span-3"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="type" className="text-right">
                    Type
                  </Label>
                  <Select
                    value={uploadForm.type}
                    onValueChange={handleTypeChange}
                    required
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Sélectionner un type" />
                    </SelectTrigger>
                    <SelectContent>
                      {documentTypes && documentTypes.length > 0 ? (
                        documentTypes.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="carte_grise">Carte grise</SelectItem>
                          <SelectItem value="assurance">Assurance</SelectItem>
                          <SelectItem value="visite_technique">Visite technique</SelectItem>
                          <SelectItem value="taxe">Taxe</SelectItem>
                          <SelectItem value="autre">Autre</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="description" className="text-right">
                    Description
                  </Label>
                  <Input
                    id="description"
                    name="description"
                    value={uploadForm.description}
                    onChange={handleInputChange}
                    className="col-span-3"
                  />
                </div>
                
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="expiryDate" className="text-right">
                    Date d'expiration
                  </Label>
                  <Input
                    id="expiryDate"
                    name="expiryDate"
                    type="date"
                    value={uploadForm.expiryDate}
                    onChange={handleInputChange}
                    className="col-span-3"
                  />
                  {proposedDate && uploadForm.expiryDate === proposedDate ? (
                    <p className="col-span-3 col-start-2 text-xs text-muted-foreground">
                      Échéance proposée d'après la durée de validité du type. Modifiable.
                    </p>
                  ) : null}
                </div>
                
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="file" className="text-right">
                    Fichier
                  </Label>
                  <div className="col-span-3 relative">
                    <Input
                      id="file"
                      type="file"
                      onChange={handleFileChange}
                      disabled={uploadMutation.isPending}
                      required
                    />
                    {uploadMutation.isPending && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-md bg-background/85 backdrop-blur-[1px]">
                        <Loader2 className="h-4 w-4 animate-spin text-primary-text" />
                        <span className="text-sm font-medium text-primary-text">Import en cours…</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button 
                  variant="secondary" 
                  type="button" 
                  onClick={() => setIsUploadDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button 
                  type="submit" 
                  disabled={uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? "Téléchargement..." : "Télécharger"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </CardHeader>
      
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-green-600" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 p-4 rounded-md flex items-center text-destructive-text">
            <AlertCircle className="h-5 w-5 mr-2" />
            Erreur lors du chargement des documents. Veuillez réessayer.
          </div>
        ) : !documents || (Array.isArray(documents) && documents.length === 0) ? (
          <div className="text-center py-6 text-muted-foreground">
            <File className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>Aucun document n'a été téléchargé pour ce véhicule.</p>
            {!readOnly && (
              <Button
                variant="link"
                onClick={() => setIsUploadDialogOpen(true)}
                className="mt-2"
              >
                Ajouter votre premier document
              </Button>
            )}
          </div>
        ) : (
          <PremiumDataTable
            columns={columns}
            rows={Array.isArray(documents) ? documents : []}
            rowKey={(doc) => doc.id}
            rowClassName={(doc, index) =>
              isDocumentExpired(doc.expiryDate)
                ? "bg-red-50/65 border-l-2 border-red-300"
                : index % 2 === 0
                  ? "bg-white"
                  : "bg-gray-50/35"
            }
            toolbar={<div className="text-sm text-gray-500">{Array.isArray(documents) ? documents.length : 0} document(s)</div>}
          />
        )}
      </CardContent>

      {/* Dialogue de confirmation de suppression */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer le document "{selectedDocument?.name}" ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="secondary" 
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
