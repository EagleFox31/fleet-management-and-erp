import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  Search, 
  Download, 
  Eye, 
  Filter,
  Calendar,
  User,
  HardDrive,
  Archive,
  CheckCircle,
  Clock
} from 'lucide-react';

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

interface WorkflowInfo {
  sessionId: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  currentStep: number;
  createdAt: string;
  registrationNumber?: string;
  brand?: string;
  model?: string;
}

export default function WorkflowDocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Récupérer tous les workflows avec leurs documents
  const { data: workflows = [], isLoading } = useQuery<any>({
    queryKey: ['/api/workflows/all-with-documents'],
  });

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

  const getStatusColor = (status: string): string => {
    const colors = {
      'in_progress': 'bg-yellow-100 text-yellow-800',
      'completed': 'bg-green-100 text-green-800',
      'abandoned': 'bg-red-100 text-red-800'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string): string => {
    const labels = {
      'in_progress': 'En cours',
      'completed': 'Terminé',
      'abandoned': 'Abandonné'
    };
    return labels[status as keyof typeof labels] || status;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  // Filtrer les workflows selon les critères
  const filteredWorkflows = workflows.filter((workflow: any) => {
    const matchesSearch = !searchTerm || 
      workflow.registrationNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workflow.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workflow.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workflow.sessionId.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || workflow.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Calculer les statistiques
  const totalDocuments = workflows.reduce((acc: number, workflow: any) => 
    acc + (workflow.documents?.length || 0), 0);
  
  const transferredDocuments = workflows.reduce((acc: number, workflow: any) => 
    acc + (workflow.documents?.filter((doc: WorkflowDocument) => doc.isTransferred).length || 0), 0);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-lg text-muted-foreground">Chargement des documents de workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Documents de Workflow</h1>
          <p className="text-muted-foreground">
            Gestion et traçabilité des documents uploadés pendant l'acquisition de véhicules
          </p>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm text-muted-foreground">Total Documents</p>
                <p className="text-2xl font-bold">{totalDocuments}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm text-muted-foreground">Transférés</p>
                <p className="text-2xl font-bold">{transferredDocuments}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-yellow-600" />
              <div>
                <p className="text-sm text-muted-foreground">En Attente</p>
                <p className="text-2xl font-bold">{totalDocuments - transferredDocuments}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Archive className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-sm text-muted-foreground">Workflows</p>
                <p className="text-2xl font-bold">{workflows.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher par immatriculation, marque, modèle ou session..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Statut du workflow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="in_progress">En cours</SelectItem>
                <SelectItem value="completed">Terminé</SelectItem>
                <SelectItem value="abandoned">Abandonné</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Liste des workflows et leurs documents */}
      <div className="space-y-4">
        {filteredWorkflows.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Aucun workflow trouvé</h3>
              <p className="text-muted-foreground">
                {searchTerm || statusFilter !== 'all'
                  ? "Aucun workflow ne correspond à vos critères de recherche."
                  : "Aucun workflow d'acquisition n'a encore été créé."}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredWorkflows.map((workflow: any) => (
            <Card key={workflow.sessionId}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span>Workflow #{workflow.sessionId.substring(0, 8)}</span>
                      <Badge className={getStatusColor(workflow.status)}>
                        {getStatusLabel(workflow.status)}
                      </Badge>
                    </CardTitle>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                      {workflow.registrationNumber && (
                        <span>Immatriculation: {workflow.registrationNumber}</span>
                      )}
                      {workflow.brand && workflow.model && (
                        <span>{workflow.brand} {workflow.model}</span>
                      )}
                      <span>Créé le {new Date(workflow.createdAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  </div>
                  <Badge variant="outline">
                    {workflow.documents?.length || 0} document(s)
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent>
                {workflow.documents && workflow.documents.length > 0 ? (
                  <div className="space-y-3">
                    {workflow.documents.map((document: WorkflowDocument) => (
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
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucun document dans ce workflow</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}