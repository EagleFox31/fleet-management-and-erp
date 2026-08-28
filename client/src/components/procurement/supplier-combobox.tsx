import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface SupplierOption {
  id: number;
  name: string;
  isActive?: boolean;
}

interface SupplierComboboxProps {
  /** Fournisseur rattaché (clé étrangère). `null` = non assigné. */
  value: number | null;
  /**
   * Nom textuel hérité, pour les pièces créées avant le rattachement par FK.
   * Affiché en repli quand `value` est nul mais qu'un nom existe encore.
   */
  legacyName?: string | null;
  onChange: (supplierId: number | null, supplierName: string) => void;
  disabled?: boolean;
}

/**
 * Sélecteur de fournisseur avec recherche et création inline.
 *
 * La création passe par `POST /api/suppliers` — jamais par une saisie libre :
 * un nom tapé à la main créerait un fournisseur fantôme, absent de la table
 * `suppliers`, invisible des commandes et des notations.
 *
 * `POST /api/suppliers` est réservé à `admin`, `secretary` et `logistics`
 * (`checkWritePermission`). Pour les autres profils — le magasinier notamment —
 * l'option de création est masquée et remplacée par une consigne, plutôt que de
 * proposer une action qui finirait en 403.
 */
export function SupplierCombobox({ value, legacyName, onChange, disabled }: SupplierComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  // Le magasinier peut créer un fournisseur "à compléter" (nom seul): il en a
  // besoin pour rattacher une pièce. Le serveur réduit sa charge utile au nom;
  // la qualification commerciale reste à l'administration.
  const canCreateSupplier =
    user?.role === "admin" ||
    user?.role === "secretary" ||
    user?.role === "logistics" ||
    user?.role === "warehouse";
  const createsDraftOnly = user?.role === "warehouse";

  const { data: suppliers = [], isLoading } = useQuery<SupplierOption[]>({
    queryKey: ["/api/suppliers", { isActive: true }],
    staleTime: 5 * 60 * 1000,
  });

  const selected = useMemo(
    () => suppliers.find((supplier) => supplier.id === value) ?? null,
    [suppliers, value],
  );

  const trimmedSearch = search.trim();
  const normalize = (raw: string) => raw.trim().replace(/\s+/g, " ").toLowerCase();

  const exactMatchExists = suppliers.some(
    (supplier) => normalize(supplier.name) === normalize(trimmedSearch),
  );
  const showCreateOption = canCreateSupplier && trimmedSearch.length > 1 && !exactMatchExists;

  const createSupplierMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/suppliers", { name });
      return response.json() as Promise<{ id: number; name: string }>;
    },
    onSuccess: async (created, name) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      const supplierName = created?.name ?? name;
      onChange(typeof created?.id === "number" ? created.id : null, supplierName);
      toast({
        title: "Fournisseur créé",
        description: createsDraftOnly
          ? `« ${supplierName} » a été ajouté. Sa fiche reste à compléter par l'administration (contact, TVA, délais).`
          : `« ${supplierName} » a été ajouté au référentiel.`,
      });
      setSearch("");
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Création impossible",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Repli d'affichage: pièce héritée, rattachée par nom mais pas encore par FK.
  const displayLabel = selected?.name ?? (value === null && legacyName ? legacyName : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="combobox-supplier"
        >
          <span className={cn(!displayLabel && "text-muted-foreground")}>
            {displayLabel ?? "Sélectionner un fournisseur"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Rechercher un fournisseur…"
            value={search}
            onValueChange={setSearch}
            data-testid="input-supplier-search"
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Chargement…</div>
            ) : (
              <CommandEmpty>
                {canCreateSupplier
                  ? "Aucun fournisseur. Saisissez un nom pour le créer."
                  : "Aucun fournisseur trouvé. La création est réservée à l'administration."}
              </CommandEmpty>
            )}

            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange(null, "");
                  setOpen(false);
                }}
                data-testid="supplier-option-none"
              >
                <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">Non assigné</span>
              </CommandItem>

              {suppliers.map((supplier) => (
                <CommandItem
                  key={supplier.id}
                  value={supplier.name}
                  onSelect={() => {
                    onChange(supplier.id, supplier.name);
                    setOpen(false);
                  }}
                  data-testid={`supplier-option-${supplier.id}`}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === supplier.id ? "opacity-100" : "opacity-0")}
                  />
                  {supplier.name}
                </CommandItem>
              ))}
            </CommandGroup>

            {showCreateOption && (
              <CommandGroup className="border-t">
                <CommandItem
                  value={`__create__${trimmedSearch}`}
                  className="cursor-pointer"
                  onSelect={() => {
                    if (!createSupplierMutation.isPending) {
                      createSupplierMutation.mutate(trimmedSearch);
                    }
                  }}
                  disabled={createSupplierMutation.isPending}
                  data-testid="supplier-option-create"
                >
                  {createSupplierMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-green-600" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4 text-green-600" />
                  )}
                  <div className="flex flex-col">
                    <span>
                      Créer le fournisseur «&nbsp;<span className="font-semibold">{trimmedSearch}</span>&nbsp;»
                    </span>
                    {createsDraftOnly && (
                      <span className="text-[11px] text-gray-400">
                        Nom seul — la fiche sera complétée par l'administration
                      </span>
                    )}
                  </div>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
