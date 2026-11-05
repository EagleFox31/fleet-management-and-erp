import { userMessageOf } from "@/lib/api-error";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  clientBillingService, 
  type InvoiceGenerationData,
  type PaymentData
} from "@/services/clientBillingService";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { canReadClientBilling } from "@shared/constants/roles";

export function useClientBilling() {
  const { toast } = useToast();

  const { user } = useAuth();
  const statistics = useQuery<any>({
    queryKey: ["/api/billing/statistics"],
    enabled: canReadClientBilling(user?.role),
    queryFn: () => clientBillingService.getStatistics(),
  });

  const clientSummary = useQuery<any>({
    queryKey: ["/api/billing/client-summary"],
    queryFn: () => clientBillingService.getClientSummary(),
  });

  const pendingInvoices = useQuery<any>({
    queryKey: ["/api/billing/invoices/pending"],
    queryFn: () => clientBillingService.getPendingInvoices(),
  });

  const overdueInvoices = useQuery<any>({
    queryKey: ["/api/billing/invoices/overdue"],
    queryFn: () => clientBillingService.getOverdueInvoices(),
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (data: InvoiceGenerationData) => clientBillingService.generateInvoice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      toast({
        title: "Facture générée",
        description: "La facture client a été générée avec succès",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."),
        variant: "destructive",
      });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: number; data: PaymentData }) =>
      clientBillingService.recordPayment(invoiceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      toast({
        title: "Paiement enregistré",
        description: "Le paiement a été enregistré avec succès",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."),
        variant: "destructive",
      });
    },
  });

  return {
    statistics,
    clientSummary,
    pendingInvoices,
    overdueInvoices,
    generateInvoice: generateInvoiceMutation.mutate,
    isGeneratingInvoice: generateInvoiceMutation.isPending,
    recordPayment: recordPaymentMutation.mutate,
    isRecordingPayment: recordPaymentMutation.isPending,
  };
}
