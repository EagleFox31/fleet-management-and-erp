import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { PROCUREMENT_ROLES } from "@shared/constants/roles";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Star, TrendingUp, HelpCircle, Building2, Filter, ChevronRight, Package } from "lucide-react";
import type { Supplier } from "@shared/schema";
import { SUPPLIER_CATEGORIES } from "@shared/constants/supplier-categories";
import { ProcurementTutorialModal } from "@/components/procurement/procurement-tutorial-modal";

export default function SuppliersListPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // Comptable et chef d'atelier consultent (SUPPLIER_READ_ROLES) ; seul l'approvisionnement écrit.
  const hasWritePermission = (PROCUREMENT_ROLES as readonly string[]).includes(user?.role || "");

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", {
      search: searchTerm || undefined,
      category: categoryFilter !== "all" ? categoryFilter : undefined,
      isActive: activeFilter !== "all" ? (activeFilter === "active" ? "true" : "false") : undefined,
    }],
  });

  const { data: topSuppliers } = useQuery<Array<{
    supplier: Supplier;
    totalSpent: number;
    invoiceCount: number;
  }>>({
    queryKey: ["/api/suppliers/top"],
  });

  const filteredSuppliers = suppliers || [];

  const openSupplierDetail = (supplierId: number) => {
    setLocation(`/procurement/suppliers/${supplierId}`);
  };

  const handleSupplierRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement | HTMLDivElement>,
    supplierId: number,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSupplierDetail(supplierId);
    }
  };

  const calculateOverallRating = (supplier: Supplier) => {
    const quality = Number(supplier.qualityRating || 0);
    const reliability = Number(supplier.reliabilityRating || 0);
    const price = Number(supplier.priceCompetitiveness || 0);
    return ((quality + reliability + price) / 3).toFixed(1);
  };

  const renderRatingStars = (rating: number) => {
    const stars: React.ReactNode[] = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"
          }`}
        />
      );
    }
    return <div className="flex gap-0.5">{stars}</div>;
  };

  return (
    <div className="space-y-5">

      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Approvisionnement</span>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Fournisseurs</h1>
                <p className="text-sm text-gray-400 mt-0.5">
                  {hasWritePermission
                    ? "Gérez vos fournisseurs et évaluez leurs performances"
                    : "Consultez les informations des fournisseurs"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-tutorial"
                onClick={() => setTutorialOpen(true)}
                className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Guide
              </Button>
              {hasWritePermission && (
                <Link href="/procurement/suppliers/new">
                  <Button
                    size="sm"
                    data-testid="button-add-supplier"
                    className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Nouveau fournisseur
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Top 5 tiles */}
          {topSuppliers && topSuppliers.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t border-gray-100">
              {topSuppliers.map((item, index) => (
                <div
                  key={item.supplier.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`top-supplier-${item.supplier.id}`}
                  onClick={() => openSupplierDetail(item.supplier.id)}
                  onKeyDown={(event) => handleSupplierRowKeyDown(event, item.supplier.id)}
                  className="group rounded-xl border border-gray-100 bg-gray-50 hover:bg-green-50 hover:border-green-200 px-4 py-3.5 flex flex-col gap-2 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/30 focus-visible:ring-offset-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                      #{index + 1}
                    </span>
                    <TrendingUp className="h-3.5 w-3.5 text-gray-300 group-hover:text-green-500 transition-colors" />
                  </div>
                  <div className="leading-tight min-w-0">
                    <p className="text-[11px] font-medium text-gray-500 truncate group-hover:text-green-800 transition-colors">
                      {item.supplier.name}
                    </p>
                    <p className="text-xl font-bold text-gray-800 leading-none mt-1">
                      {(item.totalSpent / 1000000).toFixed(1)}
                      <span className="text-sm font-semibold text-gray-500 ml-0.5">M</span>
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {item.invoiceCount} facture{item.invoiceCount > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Filtres ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
            <Filter className="h-3.5 w-3.5 text-green-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Filtres</span>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                placeholder="Rechercher par nom, contact, email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-suppliers"
                className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger data-testid="select-category-filter" className="border-gray-100 bg-gray-50 text-sm">
                <SelectValue placeholder="Toutes les catégories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les catégories</SelectItem>
                {SUPPLIER_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger data-testid="select-active-filter" className="border-gray-100 bg-gray-50 text-sm">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="active">Actifs</SelectItem>
                <SelectItem value="inactive">Inactifs</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Liste ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
            <Building2 className="h-3.5 w-3.5 text-green-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Fournisseurs</span>
          <span className="ml-auto text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            {filteredSuppliers.length}
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2 animate-pulse">
              <Building2 className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm text-gray-400">Chargement...</p>
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <Package className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-sm text-gray-500 font-medium">Aucun fournisseur trouvé</p>
            <p className="text-xs text-gray-400 mt-1">Ajustez les filtres ou créez un nouveau fournisseur</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Nom</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Catégorie</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Contact</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Délai paiement</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Note</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Statut</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    data-testid={`row-supplier-${supplier.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openSupplierDetail(supplier.id)}
                    onKeyDown={(event) => handleSupplierRowKeyDown(event, supplier.id)}
                    className="group border-b border-gray-50 last:border-0 transition-colors hover:bg-green-50/60 cursor-pointer border-l-2 border-l-transparent hover:border-l-green-500 focus-visible:outline-none focus-visible:bg-green-50/60 focus-visible:border-l-green-500"
                  >
                    <td className="px-5 py-3.5">
                      <span className="text-[13px] font-semibold text-gray-800 group-hover:text-green-700 transition-colors">
                        {supplier.name}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50">
                        {supplier.category || "Non classé"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-[12px]">
                        <div className="font-medium text-gray-700">{supplier.contactName || "-"}</div>
                        <div className="text-gray-400">{supplier.email || "-"}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-gray-600">
                      {supplier.paymentTerms ? `${supplier.paymentTerms} j.` : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {renderRatingStars(Math.round(Number(calculateOverallRating(supplier))))}
                        <span className="text-[11px] text-gray-400">{calculateOverallRating(supplier)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {supplier.isActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Actif</span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactif</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-green-600 transition-colors ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProcurementTutorialModal
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
      />
    </div>
  );
}
