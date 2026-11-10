import { userMessageOf } from "@/lib/api-error";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useFormDraft } from "@/hooks/use-form-draft";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { supplierInvoiceDraft } from "@/lib/form-drafts";

interface Supplier {
  id: number;
  name: string;
}

interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplierId: number;
  totalAmountTTC: string;
}

const formSchema = z.object({
  invoiceNumber: z.string().min(1, "Numéro de facture requis"),
  supplierId: z.number({ required_error: "Sélectionnez un fournisseur" }),
  purchaseOrderId: z.number().optional(),
  invoiceDate: z.string().min(1, "Date de facture requise"),
  dueDate: z.string().min(1, "Date d'échéance requise"),
  totalAmountHT: z.string().min(1, "Montant HT requis"),
  vatAmount: z.string().min(1, "Montant TVA requis"),
  totalAmountTTC: z.string().min(1, "Montant TTC requis"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewSupplierInvoicePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canCreateInvoice = ["admin", "secretary", "accountant"].includes(user?.role || "");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      notes: '',
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: supplierInvoiceDraft.storage as any,
    isEmpty: supplierInvoiceDraft.isEmpty as any,
    userId: user?.id,
  });

  // Charger les fournisseurs actifs
  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", { isActive: true }],
  });

  // Charger les commandes d'achat du fournisseur sélectionné
  const selectedSupplierId = form.watch("supplierId");
  const { data: purchaseOrders = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders", { supplierId: selectedSupplierId }],
    enabled: !!selectedSupplierId,
  });

  // Calculer automatiquement le montant TTC
  const totalAmountHT = form.watch("totalAmountHT");
  const vatAmount = form.watch("vatAmount");
  
  // Auto-calculer TTC quand HT et TVA changent
  if (totalAmountHT && vatAmount) {
    const ht = parseFloat(totalAmountHT);
    const tva = parseFloat(vatAmount);
    if (!isNaN(ht) && !isNaN(tva)) {
      const ttc = (ht + tva).toFixed(2);
      if (form.getValues("totalAmountTTC") !== ttc) {
        form.setValue("totalAmountTTC", ttc);
      }
    }
  }

  // Mutation pour créer la facture
  const createInvoiceMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      // Mapper les champs frontend → backend
      const payload = {
        ...data,
        amountHT: data.totalAmountHT, // Backend attend 'amountHT'
        totalTTC: data.totalAmountTTC, // Backend attend 'totalTTC'
      };
      const res = await apiRequest("POST", "/api/supplier-invoices", payload);
      return await res.json();
    },
    onSuccess: (result: any) => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      
      const message = result.validation?.hasDiscrepancy 
        ? `Facture créée avec écart de ${result.validation.variancePercentage}%`
        : "Facture créée avec succès";

      toast({
        title: "Succès",
        description: message,
        variant: result.validation?.hasDiscrepancy ? "default" : "default",
      });

      setLocation(`/procurement/invoices/${result.invoice.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de créer la facture"),
        variant: "destructive",
      });
    },
  });

  // Un double clic envoyait la saisie deux fois (la seconde finit en 409 « déjà saisie »).
  const submitInvoice = useSingleFlightMutate(createInvoiceMutation.mutate);

  const onSubmit = (data: FormValues) => {
    submitInvoice(data);
  };

  if (!canCreateInvoice) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-amber-700">Accès restreint</CardTitle>
            <CardDescription>
              Seuls l&apos;administrateur et la secrétaire peuvent créer une facture fournisseur.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setLocation("/procurement/invoices")}>
              Retour aux factures
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (suppliersLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-4 w-[32rem]" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Nouvelle Facture Fournisseur</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Saisir une nouvelle facture avec contrôle 3 voies automatique
          </p>
        </div>
      </div>

      {/* Formulaire */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Informations de la Facture
          </CardTitle>
          <CardDescription>
            Le système validera automatiquement la facture contre la commande d'achat
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Numéro de facture */}
                <FormField
                  control={form.control}
                  name="invoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numéro de Facture *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ex: FA-2025-001" 
                          {...field} 
                          data-testid="input-invoice-number"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Fournisseur */}
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fournisseur *</FormLabel>
                      <Select
                        value={field.value?.toString()}
                        onValueChange={(value) => {
                          field.onChange(parseInt(value));
                          form.setValue("purchaseOrderId", undefined);
                        }}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-supplier">
                            <SelectValue placeholder="Sélectionner un fournisseur" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id.toString()}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Commande d'achat (optionnel) */}
                <FormField
                  control={form.control}
                  name="purchaseOrderId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commande d'Achat (optionnel)</FormLabel>
                      <Select
                        value={field.value?.toString() || "none"}
                        onValueChange={(value) => field.onChange(value === "none" ? undefined : parseInt(value))}
                        disabled={!selectedSupplierId}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-purchase-order">
                            <SelectValue placeholder="Sélectionner une commande" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Aucune commande</SelectItem>
                          {purchaseOrders.map((order) => (
                            <SelectItem key={order.id} value={order.id.toString()}>
                              {order.orderNumber} - {formatPrice(order.totalAmountTTC)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Date de facture */}
                <FormField
                  control={form.control}
                  name="invoiceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date de Facture *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          data-testid="input-invoice-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Date d'échéance */}
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date d'Échéance *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          data-testid="input-due-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Montant HT */}
                <FormField
                  control={form.control}
                  name="totalAmountHT"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Montant HT (FCFA) *</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01"
                          placeholder="0.00" 
                          {...field} 
                          data-testid="input-amount-ht"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Montant TVA */}
                <FormField
                  control={form.control}
                  name="vatAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Montant TVA (FCFA) *</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01"
                          placeholder="0.00" 
                          {...field} 
                          data-testid="input-vat-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Montant TTC */}
                <FormField
                  control={form.control}
                  name="totalAmountTTC"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Montant TTC (FCFA) *</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01"
                          placeholder="0.00" 
                          {...field} 
                          data-testid="input-amount-ttc"
                          readOnly
                          className="bg-gray-100 dark:bg-gray-800"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optionnel)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Informations complémentaires..." 
                        {...field} 
                        data-testid="textarea-notes"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/procurement/invoices")}
                  data-testid="button-cancel"
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={createInvoiceMutation.isPending}
                  data-testid="button-submit"
                >
                  {createInvoiceMutation.isPending ? "Création..." : "Créer la Facture"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
