import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Building2, FileText, StickyNote, User2, ArrowLeft } from "lucide-react";
import { insertSupplierSchema } from "@shared/schema";
import type { InsertSupplier, Supplier } from "@shared/schema";
import { SUPPLIER_CATEGORIES } from "@shared/constants/supplier-categories";
import { apiRequest } from "@/lib/queryClient";

export default function EditSupplierPage() {
  const [, params] = useRoute("/procurement/suppliers/:id/edit");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const supplierId = params?.id ? parseInt(params.id) : null;

  const { data: supplierData, isLoading } = useQuery<{
    supplier: Supplier;
  }>({
    queryKey: [`/api/suppliers/${supplierId}`],
    enabled: !!supplierId,
  });

  const form = useForm<InsertSupplier>({
    resolver: zodResolver(insertSupplierSchema.partial()),
    values: supplierData?.supplier
      ? {
          name: supplierData.supplier.name || "",
          contactName: supplierData.supplier.contactName || "",
          email: supplierData.supplier.email || "",
          phone: supplierData.supplier.phone || "",
          address: supplierData.supplier.address || "",
          category: supplierData.supplier.category || "",
          siret: supplierData.supplier.siret || "",
          vatNumber: supplierData.supplier.vatNumber || "",
          paymentTerms: supplierData.supplier.paymentTerms || 30,
          deliveryTerms: supplierData.supplier.deliveryTerms || "",
          notes: supplierData.supplier.notes || "",
          isActive: supplierData.supplier.isActive ?? true,
        }
      : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertSupplier>) => {
      const response = await apiRequest("PATCH", `/api/suppliers/${supplierId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({
        title: "Fournisseur modifié",
        description: "Les modifications ont été enregistrées avec succès.",
      });
      setLocation(`/procurement/suppliers/${supplierId}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Une erreur est survenue lors de la modification.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertSupplier) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-32 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
        <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (!supplierData) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mb-3">
          <Building2 className="w-7 h-7 text-gray-300" />
        </div>
        <p className="text-sm text-gray-400">Fournisseur introuvable</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/procurement/suppliers")}
          className="mt-3 text-gray-500"
        >
          Retour à la liste
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* ── Hero banner ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #bbf7d0 100%)" }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "radial-gradient(circle, #16a34a 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative px-5 py-5 md:px-7 md:py-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1 mb-3 text-green-900/70 hover:text-green-950 hover:bg-green-600/10"
            onClick={() => setLocation(`/procurement/suppliers/${supplierId}`)}
            data-testid="button-back-supplier-edit"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Retour à la fiche
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-600/10 border border-green-200 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-green-700" />
            </div>
            <div>
              <div className="mb-0.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Approvisionnement</span>
              </div>
              <h1 className="text-xl font-bold text-green-950 leading-tight">Modifier le fournisseur</h1>
              <p className="text-sm text-green-700/70 mt-0.5">{supplierData.supplier.name}</p>
            </div>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

          {/* ── Informations de base ── */}
          <Card className="overflow-hidden border border-gray-100 shadow-sm">
            <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5 text-green-600" />
                </div>
                Informations de base
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-gray-700">Nom de l'entreprise *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="CFAO MOBILITY, MTN, etc."
                        {...field}
                        data-testid="input-name"
                        className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">Catégorie</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-category" className="border-gray-200 text-[13px]">
                            <SelectValue placeholder="Sélectionner une catégorie" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPLIER_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">Délai de paiement (jours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                          data-testid="input-payment-terms"
                          className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                        />
                      </FormControl>
                      <FormDescription className="text-[11px] text-gray-400">
                        Nombre de jours pour payer les factures
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Contact ── */}
          <Card className="overflow-hidden border border-gray-100 shadow-sm">
            <div className="h-0.5 bg-gradient-to-r from-blue-500 to-sky-400" />
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
                  <User2 className="w-3.5 h-3.5 text-blue-600" />
                </div>
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-gray-700">Nom du contact</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Jean Dupont"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-contact-name"
                        className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="contact@example.com"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-email"
                          className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">Téléphone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="+237 6 XX XX XX XX"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-phone"
                          className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-gray-700">Adresse complète</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Rue, ville, quartier..."
                        {...field}
                        value={field.value || ""}
                        data-testid="textarea-address"
                        className="border-gray-200 focus-visible:ring-green-500/20 text-[13px] resize-none"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ── Informations légales ── */}
          <Card className="overflow-hidden border border-gray-100 shadow-sm">
            <div className="h-0.5 bg-gradient-to-r from-violet-500 to-purple-400" />
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5 text-violet-600" />
                </div>
                Informations légales
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="siret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">SIRET/SIREN</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="123456789"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-siret"
                          className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vatNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[13px] font-medium text-gray-700">Numéro TVA</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="FR12345678901"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-vat-number"
                          className="border-gray-200 focus-visible:ring-green-500/20 text-[13px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="deliveryTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-gray-700">Conditions de livraison</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Délai, frais de port, conditions spécifiques..."
                        {...field}
                        value={field.value || ""}
                        data-testid="textarea-delivery-terms"
                        className="border-gray-200 focus-visible:ring-green-500/20 text-[13px] resize-none"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ── Notes ── */}
          <Card className="overflow-hidden border border-gray-100 shadow-sm">
            <div className="h-0.5 bg-gradient-to-r from-gray-300 to-gray-200" />
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                <div className="w-6 h-6 rounded-md bg-gray-50 flex items-center justify-center">
                  <StickyNote className="w-3.5 h-3.5 text-gray-500" />
                </div>
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px] font-medium text-gray-700">Notes internes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Informations complémentaires..."
                        {...field}
                        value={field.value || ""}
                        data-testid="textarea-notes"
                        className="border-gray-200 focus-visible:ring-green-500/20 text-[13px] resize-none"
                        rows={4}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-3 pb-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation(`/procurement/suppliers/${supplierId}`)}
              data-testid="button-cancel"
              className="border-gray-200 text-gray-600 hover:bg-gray-50 text-[13px]"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="button-submit"
              className="bg-green-600 hover:bg-green-700 text-white text-[13px]"
            >
              {updateMutation.isPending ? "Enregistrement..." : "Enregistrer les modifications"}
            </Button>
          </div>

        </form>
      </Form>
    </div>
  );
}
