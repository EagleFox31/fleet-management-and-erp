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
import { Textarea } from "@/components/ui/textarea";
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

interface RenewalCenter {
  id: number;
  name: string;
  documentType?: VehicleDocument["type"] | null;
  address?: string | null;
  contact?: string | null;
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
}

export function VehicleDocuments({ vehicleId }: VehicleDocumentsProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRenewDialogOpen, setIsRenewDialogOpen] = useState(false);
  const [renewalStep, setRenewalStep] = useState<1 | 2>(1);
  const [selectedDocument, setSelectedDocument] = useState<VehicleDocument | null>(null);
  const [selectedRenewalDocument, setSelectedRenewalDocument] = useState<VehicleDocument | null>(null);
  const [centerSelection, setCenterSelection] = useState<string>("");
  const canRequestRenewal = ["admin", "workshop_manager", "secretary", "logistics"].includes(user?.role || "");
  // Même garde que DELETE /api/documents/:id (isWorkshopManager).
  const canDeleteDocument = ["admin", "workshop_manager"].includes(user?.role || "");

  const [renewalForm, setRenewalForm] = useState({
    comment: "",
    assignedRole: "secretary",
    newExpiryDate: "",
    centerName: "",
    centerAddress: "",
    centerContact: "",
  });
  
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

  const { data: renewalCentersData = [] } = useQuery<RenewalCenter[]>({
    queryKey: ["/api/document-renewals/centers", selectedRenewalDocument?.type],
    enabled: isRenewDialogOpen && !!selectedRenewalDocument?.type,
    queryFn: async () => {
      const query = selectedRenewalDocument?.type
        ? `?documentType=${encodeURIComponent(selectedRenewalDocument.type)}`
        : "";
      const response = await fetch(`/api/document-renewals/centers${query}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Impossible de charger les centres agréés.");
      }
      return response.json();
    },
    retry: false,
  });
  const renewalCenters = Array.isArray(renewalCentersData) ? renewalCentersData : [];

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

  const quickRenewDocumentMutation = useMutation({
    mutationFn: async (payload: {
      vehicleId: number;
      vehicleDocumentId: number;
      comment: string;
      assignedRole: string | null;
      newExpiryDate: string;
      centerId: number | null;
      centerName: string | null;
      centerAddress: string | null;
      centerContact: string | null;
    }) => {
      const response = await apiRequest("POST", "/api/document-renewals/quick-renew", payload);
      return response.json();
    },
    onSuccess: async (payload: any) => {
      const updatedDocument = payload?.document && typeof payload.document === "object" ? payload.document as Record<string, any> : null;
      const updatedDocumentId = Number(updatedDocument?.id ?? 0);
      const updatedDocumentType = String(updatedDocument?.type || "");
      const updatedExpiryDate = String(updatedDocument?.expiryDate ?? updatedDocument?.expiry_date ?? "").trim();

      if (updatedDocumentId > 0) {
        queryClient.setQueryData([`/api/vehicles/${vehicleId}/documents`], (currentData: unknown) => {
          if (!Array.isArray(currentData)) return currentData;
          return currentData.map((item: any) =>
            Number(item?.id) === updatedDocumentId ? { ...item, ...updatedDocument } : item,
          );
        });

        if (updatedExpiryDate && ["carte_grise", "assurance", "visite_technique"].includes(updatedDocumentType)) {
          queryClient.setQueriesData(
            {
              predicate: (query) => {
                const [firstKey] = query.queryKey ?? [];
                return typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey);
              },
            },
            (currentData: unknown) => {
              if (!currentData || typeof currentData !== "object" || Array.isArray(currentData)) return currentData;
              const next = { ...(currentData as Record<string, any>) };
              if (updatedDocumentType === "carte_grise") next.licensePlateExpiry = updatedExpiryDate;
              if (updatedDocumentType === "assurance") next.insuranceExpiry = updatedExpiryDate;
              if (updatedDocumentType === "visite_technique") next.technicalInspectionDate = updatedExpiryDate;
              return next;
            },
          );
        }
      }

      toast({
        title: "Document renouvelé",
        description:
          payload?.message || "Le document et les conformités ont été mis à jour.",
      });
      setIsRenewDialogOpen(false);
      setRenewalStep(1);
      setSelectedRenewalDocument(null);
      setCenterSelection("");
      setRenewalForm({
        comment: "",
        assignedRole: "secretary",
        newExpiryDate: "",
        centerName: "",
        centerAddress: "",
        centerContact: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all-with-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/document-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expiring-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expired-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/statistics/fleet"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}`] });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [firstKey, secondKey, thirdKey] = query.queryKey ?? [];

          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey)) {
            return true;
          }

          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey)) {
            return true;
          }

          if (firstKey === "/api/vehicles" && typeof secondKey === "number" && thirdKey === "status-history") {
            return true;
          }

          if (firstKey === "/api/document-renewals/requests" && typeof secondKey === "number") {
            return true;
          }

          return false;
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/date-alerts"] });
      await Promise.allSettled([
        queryClient.refetchQueries({ queryKey: [`/api/vehicles/${vehicleId}/documents`], type: "all" }),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/document-stats"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/expiring-docs"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/expired-docs"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/document-renewals/requests"], type: "active" }),
      ]);
    },
    onError: (error: any) => {
      toast({
        title: "Échec de la demande",
      description: userMessageOf(error, "Impossible de renouveler ce document."),
        variant: "destructive",
      });
    },
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
    // Rediriger vers l'API pour télécharger le fichier
    window.open(`/api/documents/${documentId}/download`, '_blank');
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

  const handleRenewalFormChange = (
    key:
      | "comment"
      | "assignedRole"
      | "newExpiryDate"
      | "centerName"
      | "centerAddress"
      | "centerContact",
    value: string,
  ) => {
    setRenewalForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmitRenewalRequest = () => {
    if (!selectedRenewalDocument) {
      return;
    }

    const comment = renewalForm.comment.trim();
    if (comment.length < 3) {
      toast({
        title: "Commentaire requis",
        description: "Ajoutez au moins 3 caractères pour décrire la demande.",
        variant: "destructive",
      });
      return;
    }

    if (!renewalForm.newExpiryDate) {
      toast({
        title: "Nouvelle date requise",
        description: "Renseignez la nouvelle date d'expiration du document.",
        variant: "destructive",
      });
      return;
    }

    const isNewCenter = centerSelection === "__new__";
    const centerName = isNewCenter ? renewalForm.centerName.trim() : "";
    const centerId =
      !isNewCenter && centerSelection.length > 0 ? Number.parseInt(centerSelection, 10) : null;

    if (!isNewCenter && !centerSelection) {
      toast({
        title: "Centre agréé requis",
        description: "Sélectionnez un centre agréé.",
        variant: "destructive",
      });
      return;
    }

    if (isNewCenter && centerName.length < 2) {
      toast({
        title: "Centre agréé requis",
        description: "Saisissez le nom du centre agréé.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      vehicleId,
      vehicleDocumentId: selectedRenewalDocument.id,
      comment,
      assignedRole: renewalForm.assignedRole || null,
      newExpiryDate: renewalForm.newExpiryDate,
      centerId: Number.isFinite(centerId as number) ? centerId : null,
      centerName: isNewCenter ? centerName : null,
      centerAddress: isNewCenter ? renewalForm.centerAddress.trim() || null : null,
      centerContact: isNewCenter ? renewalForm.centerContact.trim() || null : null,
    };

    quickRenewDocumentMutation.mutate(payload);
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
              <Trash2 className="h-4 w-4 text-destructive" />
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
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium text-primary">Import en cours…</span>
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
      </CardHeader>
      
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-green-600" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 p-4 rounded-md flex items-center text-destructive">
            <AlertCircle className="h-5 w-5 mr-2" />
            Erreur lors du chargement des documents. Veuillez réessayer.
          </div>
        ) : !documents || (Array.isArray(documents) && documents.length === 0) ? (
          <div className="text-center py-6 text-muted-foreground">
            <File className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>Aucun document n'a été téléchargé pour ce véhicule.</p>
            <Button 
              variant="link" 
              onClick={() => setIsUploadDialogOpen(true)}
              className="mt-2"
            >
              Ajouter votre premier document
            </Button>
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

      <Dialog
        open={isRenewDialogOpen}
        onOpenChange={(open) => {
          setIsRenewDialogOpen(open);
          if (!open) {
            setSelectedRenewalDocument(null);
            setRenewalStep(1);
            setCenterSelection("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Renouveler le document</DialogTitle>
            <DialogDescription>
              Workflow simple en 2 étapes: informations puis mise à jour du document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 ${renewalStep === 1 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                1. Contexte
              </span>
              <span className={`rounded-full px-2 py-1 ${renewalStep === 2 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                2. Mise à jour
              </span>
            </div>

            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-sm font-semibold text-orange-900">
                {selectedRenewalDocument?.name || "Document"}
              </p>
              <p className="text-xs text-orange-700">
                Type: {selectedRenewalDocument ? getDocumentTypeLabel(selectedRenewalDocument.type) : "—"} •
                Expiration: {selectedRenewalDocument ? formatDate(selectedRenewalDocument.expiryDate) : "N/A"}
              </p>
            </div>

            {renewalStep === 1 ? (
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="renewal-comment">Motif / commentaire *</Label>
                  <Textarea
                    id="renewal-comment"
                    placeholder="Ex: Visite technique renouvelée ce jour."
                    value={renewalForm.comment}
                    onChange={(event) => handleRenewalFormChange("comment", event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Service responsable</Label>
                  <Select
                    value={renewalForm.assignedRole || "none"}
                    onValueChange={(value) => handleRenewalFormChange("assignedRole", value === "none" ? "" : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir un service" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Non assigné</SelectItem>
                      <SelectItem value="secretary">Secrétariat</SelectItem>
                      <SelectItem value="logistics">Logistique</SelectItem>
                      <SelectItem value="workshop_manager">Chef d'atelier</SelectItem>
                      <SelectItem value="admin">Administration</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Centre agréé *</Label>
                  <Select
                    value={centerSelection || "none"}
                    onValueChange={(value) => setCenterSelection(value === "none" ? "" : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un centre agréé" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sélectionner</SelectItem>
                      {renewalCenters.map((center) => (
                        <SelectItem key={center.id} value={String(center.id)}>
                          {center.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Ajouter un nouveau centre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {centerSelection === "__new__" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="grid gap-2 md:col-span-2">
                      <Label htmlFor="new-center-name">Nom du centre *</Label>
                      <Input
                        id="new-center-name"
                        placeholder="Ex: Centre Auto Contrôle Bonabéri"
                        value={renewalForm.centerName}
                        onChange={(event) => handleRenewalFormChange("centerName", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-center-address">Adresse</Label>
                      <Input
                        id="new-center-address"
                        placeholder="Bonabéri, Douala"
                        value={renewalForm.centerAddress}
                        onChange={(event) => handleRenewalFormChange("centerAddress", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-center-contact">Contact</Label>
                      <Input
                        id="new-center-contact"
                        placeholder="+237 6xx xxx xxx"
                        value={renewalForm.centerContact}
                        onChange={(event) => handleRenewalFormChange("centerContact", event.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="renewal-new-expiry">Nouvelle date d'expiration *</Label>
                  <Input
                    id="renewal-new-expiry"
                    type="date"
                    value={renewalForm.newExpiryDate}
                    onChange={(event) => handleRenewalFormChange("newExpiryDate", event.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  En validant, la page Documents et les indicateurs de conformité seront mis à jour immédiatement.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsRenewDialogOpen(false);
                setSelectedRenewalDocument(null);
                setRenewalStep(1);
                setCenterSelection("");
              }}
            >
              Annuler
            </Button>
            {renewalStep === 1 ? (
              <Button
                onClick={() => setRenewalStep(2)}
                disabled={
                  renewalForm.comment.trim().length < 3 ||
                  (!centerSelection ||
                    (centerSelection === "__new__" && renewalForm.centerName.trim().length < 2))
                }
              >
                Suivant
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRenewalStep(1)}>
                  Précédent
                </Button>
                <Button onClick={handleSubmitRenewalRequest} disabled={quickRenewDocumentMutation.isPending}>
                  {quickRenewDocumentMutation.isPending ? "Mise à jour..." : "Renouveler"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
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
