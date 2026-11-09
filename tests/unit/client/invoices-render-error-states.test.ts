import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { describe, expect, it, vi } from "vitest";

/**
 * Rendu serveur (react-dom/server) : les écrans de factures dont une lecture échoue affichent
 * « Indisponible » et le message de l'erreur, jamais « 0 », « Aucune facture » ni une somme partielle.
 * Même méthode que `money-stock-render-error-states.test.ts` : requête mise en erreur dans le
 * cache (`queryCache.build` + `setState`, aucun réseau), page rendue, fragment de tuile isolé.
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/", () => {}],
  useParams: () => ({ id: "7" }),
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
  useRoute: () => [false, {}],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => undefined };
});
vi.mock("@/components/procurement/import-excel-dialog", () => ({ ImportExcelDialog: () => null }));
vi.mock("@/components/procurement/procurement-tutorial-modal", () => ({ ProcurementTutorialModal: () => null }));

(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

type Outcome = { data: unknown } | { error: Error };
type Seed = Array<[readonly unknown[], Outcome]>;

function render(Page: React.ComponentType, seed: Seed): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  for (const [queryKey, outcome] of seed) {
    if ("error" in outcome) {
      client.getQueryCache().build(client, { queryKey }).setState({
        status: "error",
        error: outcome.error,
        data: undefined,
        fetchStatus: "idle",
        errorUpdateCount: 1,
        errorUpdatedAt: Date.now(),
      });
    } else {
      client.setQueryData(queryKey, outcome.data);
    }
  }
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(TooltipProvider, null, React.createElement(Page)),
    ),
  );
}

const FAILURE = { error: new Error("boom") };
/** Supprime tout espace (insécables compris) : les montants fr-FR séparent les milliers. */
const squash = (text: string) => text.replace(/[\s  ]/g, "");
const strip = (html: string) => html.replace(/<[^>]*>/g, "|");

/** Texte de l'élément portant ce data-testid. */
function testIdText(html: string, testId: string): string {
  const match = html.match(new RegExp(`data-testid="${testId}"[^>]*>((?:(?!</(?:div|p|span)>).)*)</`));
  expect(match, `élément ${testId} absent du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

/** Texte qui suit un libellé, sur 300 caractères. */
function after(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at, `libellé « ${label} » absent du rendu`).toBeGreaterThan(-1);
  return strip(html.slice(at, at + 300));
}

const CLIENT_INVOICES = {
  invoices: [
    {
      id: 1,
      invoiceNumber: "FAC-1",
      status: "pending",
      amountTTC: "12345",
      balance: "12345",
      invoiceDate: "2026-11-01",
      dueDate: "2026-12-01",
      client: { name: "Client A" },
    },
  ],
  summary: { total: 1, totalAmountTTC: 12345, totalPaid: 0, totalBalance: 12345, pending: 1, paid: 0 },
};

describe("rendu: factures en échec affichent Indisponible, jamais 0", () => {
  describe("factures clients (operations/invoices)", () => {
    const key = ["/api/billing/invoices", { status: "" }];

    it("échec : tuiles, compteur et liste lisent Indisponible, avec le message d'erreur", async () => {
      const { default: Page } = await import("@/pages/operations/invoices/index");
      const html = render(Page, [[key, FAILURE]]);
      expect(testIdText(html, "stat-total-amount")).toBe("Indisponible");
      expect(testIdText(html, "stat-paid")).toBe("Indisponible");
      expect(after(html, 'data-testid="stat-paid"')).toContain("Indisponible");
      expect(after(html, 'data-testid="stat-pending"')).toContain("Indisponible");
      expect(after(html, "Factures (")).toContain("Indisponible");
      expect(html).toContain('data-testid="invoices-load-error"');
      expect(html).not.toContain("Aucune facture trouvée");
    });

    it("témoin : données saines, 12 345 affiché", async () => {
      const { default: Page } = await import("@/pages/operations/invoices/index");
      const html = render(Page, [[key, { data: CLIENT_INVOICES }]]);
      expect(squash(testIdText(html, "stat-total-amount"))).toContain("12345");
      expect(html).not.toContain("Indisponible");
      expect(html).toContain("FAC-1");
    });
  });

  describe("tableau de bord de facturation (invoicing-dashboard)", () => {
    const key = ["/api/billing/statistics"];

    it("échec : état d'erreur distinct, pas « Aucune donnée disponible »", async () => {
      const { InvoicingDashboard } = await import("@/components/operations/invoicing-dashboard");
      const html = render(InvoicingDashboard, [[key, FAILURE]]);
      expect(html).toContain('data-testid="invoicing-dashboard-error"');
      expect(html).toContain("Indisponible");
      expect(html).not.toContain("Aucune donnée disponible");
    });

    it("témoin : données saines, 12 345 affiché et pas d'erreur", async () => {
      const { InvoicingDashboard } = await import("@/components/operations/invoicing-dashboard");
      const html = render(InvoicingDashboard, [
        [
          key,
          {
            data: {
              totalInvoices: 3,
              totalAmountHT: 10000,
              totalAmountTTC: 12345,
              totalPaid: 0,
              totalBalance: 12345,
              byStatus: [],
              byClient: [],
            },
          },
        ],
      ]);
      expect(html).not.toContain("invoicing-dashboard-error");
      expect(squash(strip(html))).toContain("12345");
    });

    it("le vrai vide (aucune donnée, aucune erreur) garde « Aucune donnée disponible »", async () => {
      const { InvoicingDashboard } = await import("@/components/operations/invoicing-dashboard");
      const html = render(InvoicingDashboard, [[key, { data: null }]]);
      expect(html).toContain("Aucune donnée disponible");
      expect(html).not.toContain("invoicing-dashboard-error");
    });
  });

  describe("factures fournisseurs (procurement/invoices)", () => {
    const listKey = ["/api/supplier-invoices", { status: "" }];
    const statsKey = ["/api/supplier-invoices/statistics"];
    const INVOICES = [
      {
        id: 1,
        invoiceNumber: "FF-1",
        supplierId: 1,
        supplierName: "Fournisseur A",
        invoiceDate: "2026-11-01",
        dueDate: "2026-12-01",
        totalAmountHT: "10000",
        totalAmountTTC: "99000",
        vatAmount: "0",
        status: "received",
        hasDiscrepancy: true,
        createdAt: "2026-11-01",
      },
    ];
    const STATS = { totalInvoices: 1, totalAmountHT: "10000", totalAmountTTC: "12345", totalPaid: "2345", totalBalance: "10000" };

    it("statistiques en échec : Montant, Dette et Payé lisent Indisponible, sans repli sur la liste", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/index");
      const html = render(Page, [[listKey, { data: INVOICES }], [statsKey, FAILURE]]);
      expect(testIdText(html, "stat-total-amount")).toBe("Indisponible");
      expect(testIdText(html, "stat-supplier-debt")).toBe("Indisponible");
      expect(testIdText(html, "stat-supplier-paid")).toBe("Indisponible");
      expect(squash(after(html, 'data-testid="stat-total-amount"'))).not.toContain("99000");
      // La liste, elle, est lisible : ses compteurs restent des nombres.
      expect(testIdText(html, "stat-total-invoices")).toBe("1");
    });

    it("liste en échec : compteurs et tableau lisent Indisponible, état d'erreur affiché", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/index");
      const html = render(Page, [[listKey, FAILURE], [statsKey, { data: STATS }]]);
      expect(testIdText(html, "stat-total-invoices")).toBe("Indisponible");
      expect(testIdText(html, "stat-pending-invoices")).toBe("Indisponible");
      expect(testIdText(html, "stat-discrepancy-invoices")).toBe("Indisponible");
      expect(html).toContain('data-testid="invoices-load-error"');
      expect(html).not.toContain("Aucune facture trouvée");
      // Les sommes viennent de /statistics, saine : elles restent affichées.
      expect(squash(testIdText(html, "stat-total-amount"))).toContain("12345");
    });

    it("témoin : tout sain, 12 345 / 2 345 / 10 000 affichés et aucun Indisponible", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/index");
      const html = render(Page, [[listKey, { data: INVOICES }], [statsKey, { data: STATS }]]);
      expect(squash(testIdText(html, "stat-total-amount"))).toContain("12345");
      expect(squash(testIdText(html, "stat-supplier-paid"))).toContain("2345");
      expect(squash(testIdText(html, "stat-supplier-debt"))).toContain("10000");
      expect(testIdText(html, "stat-total-invoices")).toBe("1");
      expect(html).not.toContain("Indisponible");
    });
  });

  describe("écarts de facturation (procurement/invoices/discrepancies)", () => {
    const key = ["/api/supplier-invoices/discrepancies"];

    it("échec : les trois tuiles lisent Indisponible et la liste montre l'erreur", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/discrepancies");
      const html = render(Page, [[key, FAILURE]]);
      expect(testIdText(html, "stat-discrepancy-count")).toBe("Indisponible");
      expect(testIdText(html, "stat-total-variance")).toBe("Indisponible");
      expect(testIdText(html, "stat-avg-variance")).toBe("Indisponible");
      expect(html).toContain('data-testid="discrepancies-load-error"');
      expect(html).not.toContain("Aucun écart à traiter");
    });

    it("témoin : données saines, 12 345 affiché", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/discrepancies");
      const html = render(Page, [
        [key, { data: { discrepancies: [], totalDiscrepancyAmount: 12345, averageVariance: 4.5 } }],
      ]);
      expect(squash(testIdText(html, "stat-total-variance"))).toContain("12345");
      expect(testIdText(html, "stat-avg-variance")).toBe("4.50%");
      expect(html).not.toContain("Indisponible");
    });
  });

  describe("détail d'une facture fournisseur (procurement/invoices/[id])", () => {
    const detailKey = ["/api/supplier-invoices/7"];
    const settlementsKey = ["/api/supplier-invoices/7/settlements"];
    const DETAIL = {
      invoice: {
        id: 7,
        invoiceNumber: "FF-7",
        invoiceDate: "2026-11-01",
        dueDate: "2026-12-01",
        totalAmountHT: "50000",
        vatAmount: "0",
        totalAmountTTC: "50000",
        status: "approved",
        hasDiscrepancy: false,
        varianceAmount: null,
        variancePercentage: null,
        notes: null,
        createdAt: "2026-11-01",
        validatedBy: 1,
        validatedDate: "2026-11-02",
        approvedBy: 1,
        approvedDate: "2026-11-03",
        paidBy: null,
        paidDate: null,
        paymentMethod: null,
        balance: "50000",
        workflowScope: "none",
      },
      supplier: { id: 1, name: "Fournisseur A" },
    };
    const SETTLEMENTS = [
      {
        id: 1,
        amount: "12345",
        status: "reconciled",
        paymentDate: "2026-11-04",
        paymentMethod: "bank_transfer",
        paymentReference: "VIR-1",
        proofReference: null,
        reconciledAt: "2026-11-05",
      },
    ];

    it("règlements en échec : bouton d'enregistrement absent, montants Indisponible, message affiché", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/[id]");
      const html = render(Page, [[detailKey, { data: DETAIL }], [settlementsKey, FAILURE]]);
      expect(html).not.toContain('data-testid="button-record-payment"');
      expect(html).not.toContain('data-testid="button-record-payment-sidebar"');
      expect(html).not.toContain('data-testid="button-record-settlement-inline"');
      expect(after(html, "Rapproché")).toContain("Indisponible");
      expect(after(html, "Saisi non rapproché")).toContain("Indisponible");
      expect(html).toContain('data-testid="settlements-load-error"');
      expect(html).not.toContain("Aucun règlement saisi");
    });

    it("témoin : règlements lus, boutons présents et montant rapproché 12 345", async () => {
      const { default: Page } = await import("@/pages/procurement/invoices/[id]");
      const html = render(Page, [[detailKey, { data: DETAIL }], [settlementsKey, { data: SETTLEMENTS }]]);
      expect(html).toContain('data-testid="button-record-payment"');
      expect(html).toContain('data-testid="button-record-payment-sidebar"');
      expect(squash(after(html, "Rapproché"))).toContain("12345");
      expect(html).not.toContain("settlements-load-error");
    });
  });
});
