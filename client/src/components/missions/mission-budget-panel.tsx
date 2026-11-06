/**
 * Budget de mission (L1f) sur la fiche mission : saisie et correction (logistique), approbation
 * (direction), décaissement depuis une banque ou une caisse, puis dépenses justifiées par ligne.
 *
 * Trois couches (AGENTS.md §2) : le cache de cette mission est mis à jour au succès de chaque
 * mutation ; l'événement `mission_budget_updated` rafraîchit les autres profils
 * (`realtime-satellites.ts`, groupe `missionBudgets`) ; les listes et le besoin du jour sont invalidés.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Landmark, Pencil, Plus, Trash2, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertModal } from "@/components/design-system";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useContractQuery } from "@/lib/contract-query";
import { userMessageOf } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { formatXaf, MISSION_BUDGET_STATUS_CLASSES, missionBudgetActions, remainingOf } from "@/lib/mission-budget-ui";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { TREASURY_BASE_PATH, type FuelRechargeSourceAccount } from "@shared/contracts/treasury";
import {
  MISSION_BUDGETS_DAILY_NEED_PATH,
  MISSION_BUDGETS_PATH,
  MISSION_BUDGET_EXPENSE_LINES,
  MISSION_BUDGET_EXPENSE_LINE_LABELS,
  MISSION_BUDGET_STATUS_LABELS,
  MISSION_DESTINATIONS_PATH,
  missionBudgetApprovePath,
  missionBudgetDisbursePath,
  missionBudgetExpensePath,
  missionBudgetExpensesPath,
  missionBudgetExpenseSchema,
  missionBudgetExpensesResponseSchema,
  missionBudgetPath,
  missionBudgetSettlePath,
  missionBudgetSchema,
  missionBudgetsResponseSchema,
  missionDestinationsResponseSchema,
  type MissionBudget,
  type MissionBudgetExpenseLine,
  type MissionBudgetExpenses,
} from "@shared/contracts/mission-budgets";

const SOURCE_ACCOUNTS_KEY = "/api/fuel-card/source-accounts";
const FREE_ENTRY = "free";

/** Clés de la fiche : le budget de la mission (filtre missionId) et ses dépenses. */
export const missionBudgetKey = (missionId: number) => [MISSION_BUDGETS_PATH, { missionId }] as const;
export const missionBudgetExpensesKey = (budgetId: number) => [MISSION_BUDGETS_PATH, budgetId, "expenses"] as const;

/** Couche 3 : listes de budgets et besoin du jour, sur cet écran comme ailleurs. */
function invalidateMissionBudgetViews() {
  queryClient.invalidateQueries({ queryKey: [MISSION_BUDGETS_PATH] });
  queryClient.invalidateQueries({ queryKey: [MISSION_BUDGETS_DAILY_NEED_PATH] });
}

type BudgetForm = {
  destinationId: string;
  budgetDate: string;
  fuelLiters: string;
  fdrAmount: string;
  extrasAmount: string;
  notes: string;
};

type ExpenseForm = { line: MissionBudgetExpenseLine; amount: string; label: string; expenseDate: string };

const today = () => isoDateInZone(new Date());
const num = (v: string) => Number(v.replace(/\s+/g, "").replace(",", "."));

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? "text-base font-semibold text-foreground" : "text-sm font-medium text-foreground"}>{formatXaf(value)}</div>
    </div>
  );
}

export function MissionBudgetPanel({ missionId, missionStatus, role }: { missionId: number; missionStatus: string; role: string | null | undefined }) {
  const { toast } = useToast();
  const fail = (title: string) => (error: unknown) => toast({ title, description: userMessageOf(error), variant: "destructive" });

  const budgetQuery = useContractQuery(MISSION_BUDGETS_PATH, missionBudgetsResponseSchema, { missionId });
  const budget = budgetQuery.data?.[0] ?? null;
  const actions = missionBudgetActions(role, budget, missionStatus);

  const expensesQuery = useQuery<MissionBudgetExpenses>({
    queryKey: missionBudgetExpensesKey(budget?.id ?? 0),
    queryFn: async (ctx) => missionBudgetExpensesResponseSchema.parse(await getQueryFn<unknown>({ on401: "throw" })(ctx)),
    enabled: budget?.status === "disbursed",
  });
  const expenses = expensesQuery.data;

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<BudgetForm | null>(null);
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({ line: "fdr", amount: "", label: "", expenseDate: today() });
  const [toDelete, setToDelete] = useState<{ budgetId: number; expenseId: number; label: string } | null>(null);

  const destinationsQuery = useContractQuery(MISSION_DESTINATIONS_PATH, missionDestinationsResponseSchema, undefined, { enabled: formOpen });
  const destinations = destinationsQuery.data ?? [];
  const accountsQuery = useQuery<FuelRechargeSourceAccount[]>({ queryKey: [SOURCE_ACCOUNTS_KEY], enabled: disburseOpen });
  const accounts = accountsQuery.data ?? [];

  /** Couche 1 : le budget de cette mission, tel que le serveur l'a écrit. */
  const applyBudget = (saved: MissionBudget) => {
    queryClient.setQueryData(missionBudgetKey(saved.missionId), [saved]);
    invalidateMissionBudgetViews();
  };

  const saveMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number | null; values: BudgetForm }) => {
      const payload = {
        budgetDate: values.budgetDate,
        destinationId: values.destinationId === FREE_ENTRY ? null : Number(values.destinationId),
        fuelLiters: num(values.fuelLiters),
        fdrAmount: num(values.fdrAmount),
        extrasAmount: values.extrasAmount.trim() ? num(values.extrasAmount) : 0,
        notes: values.notes.trim() || null,
      };
      const res = id === null
        ? await apiRequest("POST", MISSION_BUDGETS_PATH, { missionId, ...payload })
        : await apiRequest("PATCH", missionBudgetPath(id), payload);
      return missionBudgetSchema.parse(await res.json());
    },
    onSuccess: (saved) => {
      applyBudget(saved);
      setFormOpen(false);
      toast({ title: "Budget enregistré", description: `Total : ${formatXaf(saved.totalAmount)}` });
    },
    onError: fail("Budget non enregistré"),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, expectedUpdatedAt }: { id: number; expectedUpdatedAt: string }) =>
      missionBudgetSchema.parse(await (await apiRequest("POST", missionBudgetApprovePath(id), { expectedUpdatedAt })).json()),
    onSuccess: (saved) => {
      applyBudget(saved);
      toast({ title: "Budget approuvé" });
    },
    onError: fail("Approbation refusée"),
  });

  const disburseMutation = useMutation({
    mutationFn: async ({ id, expectedUpdatedAt, treasuryAccountId }: { id: number; expectedUpdatedAt: string; treasuryAccountId: number }) =>
      missionBudgetSchema.parse(await (await apiRequest("POST", missionBudgetDisbursePath(id), { expectedUpdatedAt, treasuryAccountId })).json()),
    onSuccess: (saved) => {
      applyBudget(saved);
      setDisburseOpen(false);
      toast({ title: "Budget décaissé", description: formatXaf(saved.totalAmount) });
    },
    onError: fail("Décaissement refusé"),
  });

  // Solde (Q18) : le reliquat revient au compte source, les soldes de trésorerie sont relus.
  const settleMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) =>
      missionBudgetSchema.parse(await (await apiRequest("POST", missionBudgetSettlePath(id))).json()),
    onSuccess: (saved) => {
      applyBudget(saved);
      queryClient.invalidateQueries({ queryKey: missionBudgetExpensesKey(saved.id) });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith(TREASURY_BASE_PATH) });
      toast({ title: "Budget soldé", description: "Le reliquat non justifié est revenu au compte source." });
    },
    onError: fail("Solde refusé"),
  });

  const addExpenseMutation = useMutation({
    mutationFn: async ({ budgetId, values }: { budgetId: number; values: ExpenseForm }) => {
      const res = await apiRequest("POST", missionBudgetExpensesPath(budgetId), {
        line: values.line,
        amount: Math.round(num(values.amount)),
        label: values.label.trim(),
        expenseDate: values.expenseDate,
      });
      return missionBudgetExpenseSchema.parse(await res.json());
    },
    onSuccess: (expense) => {
      // Couche 1 : la dépense et le reste de sa ligne, sans attendre la relecture.
      queryClient.setQueryData<MissionBudgetExpenses>(missionBudgetExpensesKey(expense.budgetId), (prev) =>
        prev && {
          ...prev,
          expenses: [...prev.expenses, expense],
          lines: prev.lines.map((l) => (l.line === expense.line ? { ...l, justified: l.justified + expense.amount, remaining: l.remaining - expense.amount } : l)),
        },
      );
      invalidateMissionBudgetViews();
      setExpenseOpen(false);
      toast({ title: "Dépense enregistrée", description: `${expense.label} : ${formatXaf(expense.amount)}` });
    },
    onError: fail("Dépense refusée"),
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async ({ budgetId, expenseId }: { budgetId: number; expenseId: number }) => {
      await apiRequest("DELETE", missionBudgetExpensePath(budgetId, expenseId));
      return { budgetId, expenseId };
    },
    onSuccess: ({ budgetId, expenseId }) => {
      queryClient.setQueryData<MissionBudgetExpenses>(missionBudgetExpensesKey(budgetId), (prev) => {
        const gone = prev?.expenses.find((e) => e.id === expenseId);
        return prev && gone
          ? {
              ...prev,
              expenses: prev.expenses.filter((e) => e.id !== expenseId),
              lines: prev.lines.map((l) => (l.line === gone.line ? { ...l, justified: l.justified - gone.amount, remaining: l.remaining + gone.amount } : l)),
            }
          : prev;
      });
      invalidateMissionBudgetViews();
      toast({ title: "Dépense supprimée" });
    },
    onError: fail("Suppression refusée"),
  });

  // Argent : un seul envoi par clic (AGENTS.md §10), l'identifiant passe par les variables.
  const submitDisburse = useSingleFlightMutate(disburseMutation.mutate);
  const submitSettle = useSingleFlightMutate(settleMutation.mutate);
  const submitExpense = useSingleFlightMutate(addExpenseMutation.mutate);
  const submitDelete = useSingleFlightMutate(deleteExpenseMutation.mutate);
  const submitApprove = useSingleFlightMutate(approveMutation.mutate);
  const submitSave = useSingleFlightMutate(saveMutation.mutate);

  const openForm = () => {
    setForm(
      budget
        ? {
            destinationId: budget.destinationId ? String(budget.destinationId) : FREE_ENTRY,
            budgetDate: budget.budgetDate,
            fuelLiters: String(budget.fuelLiters),
            fdrAmount: String(budget.fdrAmount),
            extrasAmount: String(budget.extrasAmount),
            notes: budget.notes ?? "",
          }
        : { destinationId: FREE_ENTRY, budgetDate: today(), fuelLiters: "", fdrAmount: "", extrasAmount: "0", notes: "" },
    );
    setFormOpen(true);
  };

  /** Le barème propose : choisir une destination pré-remplit litres et FDR, toujours modifiables. */
  const pickDestination = (value: string) => {
    const d = destinations.find((x) => String(x.id) === value);
    setForm((f) => f && { ...f, destinationId: value, ...(d ? { fuelLiters: String(d.fuelLiters), fdrAmount: String(d.fdrAmount) } : {}) });
  };

  if (budgetQuery.isLoading) {
    return <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Chargement du budget...</div>;
  }
  if (budgetQuery.isError) {
    return <div className="rounded-2xl border bg-card p-6 text-sm text-destructive-text">{userMessageOf(budgetQuery.error, "Budget indisponible.")}</div>;
  }

  return (
    <div className="space-y-4" data-testid="mission-budget-panel">
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Budget de mission</h3>
            {budget && (
              <Badge className={MISSION_BUDGET_STATUS_CLASSES[budget.status]} data-testid="mission-budget-status">
                {MISSION_BUDGET_STATUS_LABELS[budget.status]}
              </Badge>
            )}
            {budget?.settledAt && (
              <Badge variant="outline" data-testid="mission-budget-settled">
                Soldé le {new Date(budget.settledAt).toLocaleDateString("fr-FR")}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(actions.create || actions.edit) && (
              <Button size="sm" variant="outline" onClick={openForm} data-testid="button-mission-budget-edit">
                {actions.create ? <Plus className="h-3.5 w-3.5 mr-1" /> : <Pencil className="h-3.5 w-3.5 mr-1" />}
                {actions.create ? "Saisir le budget" : "Corriger"}
              </Button>
            )}
            {budget && actions.approve && (
              <Button
                size="sm"
                onClick={() => submitApprove({ id: budget.id, expectedUpdatedAt: budget.updatedAt })}
                disabled={approveMutation.isPending}
                data-testid="button-mission-budget-approve"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Approuver
              </Button>
            )}
            {budget && actions.disburse && (
              <Button size="sm" onClick={() => { setAccountId(""); setDisburseOpen(true); }} data-testid="button-mission-budget-disburse">
                <Landmark className="h-3.5 w-3.5 mr-1" />
                Décaisser
              </Button>
            )}
            {budget && actions.settle && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => submitSettle({ id: budget.id })}
                disabled={settleMutation.isPending}
                data-testid="button-mission-budget-settle"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1" />
                Solder
              </Button>
            )}
          </div>
        </div>

        {!budget ? (
          <p className="text-sm text-muted-foreground" data-testid="mission-budget-empty">
            Aucun budget saisi pour cette mission.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Amount label={`Carburant (${budget.fuelLiters} L × ${formatXaf(budget.fuelUnitPrice)})`} value={budget.fuelAmount} />
              <Amount label="FDR" value={budget.fdrAmount} />
              <Amount label="Frais annexes" value={budget.extrasAmount} />
              <Amount label="Total" value={budget.totalAmount} strong />
            </div>
            <p className="text-xs text-muted-foreground">
              Prix du carburant figé au {budget.budgetDate}.{budget.notes ? ` ${budget.notes}` : ""}
            </p>
          </>
        )}
      </div>

      {budget?.status === "disbursed" && (
        <div className="rounded-2xl border bg-card p-5 space-y-4" data-testid="mission-budget-expenses">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Dépenses justifiées</h3>
            {actions.expenses && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExpenseForm({ line: remainingOf(expenses, "fdr") > 0 ? "fdr" : "carburant", amount: "", label: "", expenseDate: today() });
                  setExpenseOpen(true);
                }}
                data-testid="button-mission-budget-add-expense"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Ajouter une dépense
              </Button>
            )}
          </div>
          {expensesQuery.isError ? (
            <p className="text-sm text-destructive-text">{userMessageOf(expensesQuery.error, "Dépenses indisponibles.")}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(expenses?.lines ?? []).map((l) => (
                  <div key={l.line} className="rounded-lg border px-3 py-2 text-sm" data-testid={`mission-budget-line-${l.line}`}>
                    <div className="font-medium text-foreground">{MISSION_BUDGET_EXPENSE_LINE_LABELS[l.line]}</div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <span>Décaissé : {formatXaf(l.disbursed)}</span>
                      <span>Justifié : {formatXaf(l.justified)}</span>
                      <span className="text-foreground">Reste : {formatXaf(l.remaining)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {expenses && expenses.expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune dépense justifiée.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {(expenses?.expenses ?? []).map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`mission-budget-expense-${e.id}`}>
                      <div className="min-w-0">
                        <div className="truncate text-foreground">{e.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {MISSION_BUDGET_EXPENSE_LINE_LABELS[e.line]} · {e.expenseDate}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{formatXaf(e.amount)}</span>
                        {actions.expenses && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={`Supprimer la dépense ${e.label}`}
                            onClick={() => setToDelete({ budgetId: e.budgetId, expenseId: e.id, label: e.label })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{budget ? "Corriger le budget" : "Saisir le budget"}</DialogTitle>
            <DialogDescription>Le carburant est calculé par le serveur au prix du jour de la date du budget.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Destination du barème</Label>
                <Select value={form.destinationId} onValueChange={pickDestination}>
                  <SelectTrigger data-testid="select-mission-budget-destination">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FREE_ENTRY}>Saisie libre</SelectItem>
                    {destinations.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="mb-date">Date du budget</Label>
                  <Input id="mb-date" type="date" value={form.budgetDate} onChange={(e) => setForm({ ...form, budgetDate: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mb-liters">Carburant (L)</Label>
                  <Input id="mb-liters" inputMode="decimal" value={form.fuelLiters} onChange={(e) => setForm({ ...form, fuelLiters: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mb-fdr">FDR (FCFA)</Label>
                  <Input id="mb-fdr" inputMode="numeric" value={form.fdrAmount} onChange={(e) => setForm({ ...form, fdrAmount: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mb-extras">Frais annexes (FCFA)</Label>
                  <Input id="mb-extras" inputMode="numeric" value={form.extrasAmount} onChange={(e) => setForm({ ...form, extrasAmount: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mb-notes">Notes</Label>
                <Textarea id="mb-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => form && submitSave({ id: budget?.id ?? null, values: form })}
              disabled={saveMutation.isPending || !form?.fuelLiters.trim() || !form?.fdrAmount.trim()}
              data-testid="button-mission-budget-save"
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disburseOpen} onOpenChange={setDisburseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Décaisser le budget</DialogTitle>
            <DialogDescription>{budget ? `${formatXaf(budget.totalAmount)} sortent du compte choisi.` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Compte source</Label>
            {accountsQuery.isSuccess && accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune banque ni caisse active : le décaissement est impossible.</p>
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger data-testid="select-mission-budget-account">
                  <SelectValue placeholder="Banque ou caisse" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.label} ({a.kind === "bank" ? "banque" : "caisse"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisburseOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => budget && submitDisburse({ id: budget.id, expectedUpdatedAt: budget.updatedAt, treasuryAccountId: Number(accountId) })}
              disabled={disburseMutation.isPending || !accountId}
              data-testid="button-mission-budget-disburse-confirm"
            >
              Décaisser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter une dépense justifiée</DialogTitle>
            <DialogDescription>Reste à justifier sur la ligne : {formatXaf(remainingOf(expenses, expenseForm.line))}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Ligne</Label>
              <Select value={expenseForm.line} onValueChange={(v) => setExpenseForm({ ...expenseForm, line: v as MissionBudgetExpenseLine })}>
                <SelectTrigger data-testid="select-mission-budget-expense-line">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSION_BUDGET_EXPENSE_LINES.map((line) => (
                    <SelectItem key={line} value={line}>
                      {MISSION_BUDGET_EXPENSE_LINE_LABELS[line]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mbe-label">Libellé</Label>
              <Input id="mbe-label" maxLength={200} value={expenseForm.label} onChange={(e) => setExpenseForm({ ...expenseForm, label: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="mbe-amount">Montant (FCFA)</Label>
                <Input id="mbe-amount" inputMode="numeric" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mbe-date">Date</Label>
                <Input id="mbe-date" type="date" max={today()} value={expenseForm.expenseDate} onChange={(e) => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => budget && submitExpense({ budgetId: budget.id, values: expenseForm })}
              disabled={addExpenseMutation.isPending || !expenseForm.label.trim() || !(num(expenseForm.amount) > 0)}
              data-testid="button-mission-budget-expense-save"
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertModal
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        variant="confirm"
        title="Supprimer la dépense ?"
        description={toDelete ? `« ${toDelete.label} » ne comptera plus dans le justifié. La trace reste en base.` : ""}
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (toDelete) submitDelete({ budgetId: toDelete.budgetId, expenseId: toDelete.expenseId });
          setToDelete(null);
        }}
      />
    </div>
  );
}
