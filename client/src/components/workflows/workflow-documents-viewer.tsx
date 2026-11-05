import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { 
  FileText, 
  Download, 
  Trash2, 
  Upload, 
  Eye, 
  Calendar,
  User,
  HardDrive,
  File
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface WorkflowDocument {
  id: number;
  workflowId: number;
  sessionId: string;
  documentType: 'carte_grise' | 'assurance' | 'visite_technique' | 'factur_achat' | 'autre';
  originalName: string;
  storedName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: number;
  uploadedAt: string;
  vehicleId?: number;
  isTransferred: boolean;
}

interface WorkflowDocumentsViewerProps {
  sessionId: string;
  workflowId?: number;
  canUpload?: boolean;
  canDelete?: boolean;
}

export function WorkflowDocumentsViewer({ 
  sessionId, 
  workflowId,
  canUpload = true,
  canDelete = true 
}: WorkflowDocumentsViewerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  // Récupérer les documents du workflow
  const { data: documents = [], isLoading } = useQuery<any>({
    queryKey: [`/api/workflows/${sessionId}/documents`],
  });

  // Mutation pour supprimer un document
  const deleteMutation = useMutation({
    mutationFn: async (documentId: number) => {
      return await apiRequest('DELETE', `/api/workflows/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/workflows/${sessionId}/documents`] });
      toast({
        title: "Document supprimé",
        description: "Le document a été supprimé avec succès.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: "Erreur lors de la suppression du document.",
        variant: "destructive",
      });
    }
  });

  // Mutation pour uploader un document
  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File, documentType: string }) => {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', documentType);
      if (workflowId) {
        formData.append('workflowId', workflowId.toString());
      }

      const response = await fetch(`/api/workflows/${sessionId}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'upload');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/workflows/${sessionId}/documents`] });
      setUploadingType(null);
      toast({
        title: "Document uploadé",
        description: "Le document a été uploadé avec succès.",
      });
    },
    onError: (error) => {
      setUploadingType(null);
      toast({
        title: "Erreur",
        description: "Erreur lors de l'upload du document.",
        variant: "destructive",
      });
    }
  });

  const handleFileUpload = (documentType: string, file: File) => {
    setUploadingType(documentType);
    uploadMutation.mutate({ file, documentType });
  };

  const handleDownload = (documentId: number, fileName: string) => {
    const link = document.createElement('a');
    link.href = `/api/workflows/documents/${documentId}`;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDocumentTypeLabel = (type: string): string => {
    const labels = {
      'carte_grise': 'Carte Grise',
      'assurance': 'Assurance',
      'visite_technique': 'Visite Technique',
      'factur_achat': 'Facture d\'Achat',
      'autre': 'Autre'
    };
    return labels[type as keyof typeof labels] || type;
  };

  const getDocumentTypeColor = (type: string): string => {
    const colors = {
      'carte_grise': 'bg-blue-100 text-blue-800',
      'assurance': 'bg-green-100 text-green-800',
      'visite_technique': 'bg-orange-100 text-orange-800',
      'factur_achat': 'bg-purple-100 text-purple-800',
      'autre': 'bg-gray-100 text-gray-800'
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const documentTypes = [
    { key: 'carte_grise', label: 'Carte Grise' },
    { key: 'assurance', label: 'Assurance' },
    { key: 'visite_technique', label: 'Visite Technique' },
    { key: 'factur_achat', label: 'Facture d\'Achat' },
  ];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Documents du Workflow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-sm text-muted-foreground">Chargement des documents...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Documents du Workflow
          <Badge variant="secondary">{documents.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Section d'upload */}
        {canUpload && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Uploader des documents</h4>
            <div className="grid grid-cols-2 gap-2">
              {documentTypes.map((docType) => {
                const hasDocument = documents.some((doc: WorkflowDocument) => doc.documentType === docType.key);
                return (
                  <div key={docType.key} className="relative">
                    <label className={`flex items-center gap-2 p-3 border border-dashed rounded-lg cursor-pointer transition-colors ${
                      hasDocument 
                        ? 'border-green-300 bg-green-50' 
                        : 'border-gray-300 hover:border-primary hover:bg-primary/5'
                    } ${uploadingType === docType.key ? 'opacity-50' : ''}`}>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleFileUpload(docType.key, file);
                          }
                        }}
                        disabled={uploadingType === docType.key}
                      />
                      {uploadingType === docType.key ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      ) : hasDocument ? (
                        <FileText className="h-4 w-4 text-green-600" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      <span className="text-sm">{docType.label}</span>
                      {hasDocument && (
                        <Badge variant="outline" className="ml-auto">Uploadé</Badge>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {documents.length > 0 && <Separator />}

        {/* Liste des documents */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Documents uploadés</h4>
          {documents.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <File className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun document uploadé</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((document: WorkflowDocument) => (
                <div key={document.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{document.originalName}</p>
                      <Badge className={getDocumentTypeColor(document.documentType)}>
                        {getDocumentTypeLabel(document.documentType)}
                      </Badge>
                      {document.isTransferred && (
                        <Badge variant="outline" className="text-green-600">Transféré</Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3 w-3" />
                        {formatFileSize(document.fileSize)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(document.uploadedAt).toLocaleDateString('fr-FR')}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Utilisateur {document.uploadedBy}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(document.id, document.originalName)}
                      className="h-8 w-8 p-0"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(`/api/workflows/documents/${document.id}`, '_blank')}
                      className="h-8 w-8 p-0"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    {canDelete && !document.isTransferred && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(document.id)}
                        disabled={deleteMutation.isPending}
                        className="h-8 w-8 p-0 text-destructive-text hover:text-destructive-text"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {documents.some((doc: WorkflowDocument) => doc.isTransferred) && (
          <>
            <Separator />
            <div className="text-xs text-muted-foreground">
              Les documents marqués "Transféré" ont été copiés vers le véhicule final et ne peuvent plus être supprimés.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}