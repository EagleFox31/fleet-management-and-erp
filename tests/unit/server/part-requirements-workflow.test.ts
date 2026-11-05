import { describe, it, expect } from "vitest";
import {
  PartRequirementWorkflow,
  STATUS_LABELS,
  type PartRequirementStatus,
} from "../../../server/services/part-requirements-workflow";
import { PART_REQUIREMENT_STATUS_LABELS } from "@shared/constants/part-requirements";

const ALL_STATUSES: PartRequirementStatus[] = [
  "pending",
  "approved",
  "rejected",
  "ordered",
  "partially_received",
  "received",
  "issued",
  "fulfilled",
  "cancel_requested",
  "cancelled",
  "partial",
  "delivered",
];

/** Graphe métier attendu — fige STATUS_TRANSITIONS via l'API publique. */
const ALLOWED_TRANSITIONS: Record<PartRequirementStatus, PartRequirementStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: ["ordered", "cancelled"],
  rejected: [],
  ordered: ["partially_received", "received", "cancel_requested"],
  partially_received: ["received", "cancel_requested"],
  received: ["issued"],
  issued: [],
  fulfilled: [],
  cancel_requested: ["cancelled", "approved"],
  cancelled: [],
  partial: ["received", "cancelled"],
  delivered: ["issued"],
};

const OTHER_USER = { requesterId: 10, currentUserId: 20 };
const SAME_USER = { requesterId: 10, currentUserId: 10 };

function validate(
  from: PartRequirementStatus,
  to: PartRequirementStatus,
  role: string,
  options?: {
    requesterId?: number;
    currentUserId?: number;
    requesterRole?: string;
  },
) {
  return PartRequirementWorkflow.validateTransition(from, to, role, options);
}

describe("PartRequirementWorkflow — graphe des transitions", () => {
  it("n'autorise que les successeurs déclarés, pour chaque statut", () => {
    for (const from of ALL_STATUSES) {
      const allowed = ALLOWED_TRANSITIONS[from];
      for (const to of ALL_STATUSES) {
        expect(
          PartRequirementWorkflow.isTransitionAllowed(from, to),
          `${from} -> ${to}`,
        ).toBe(allowed.includes(to));
      }
    }
  });

  it("refuse les sauts hors chaîne (ex. pending -> issued)", () => {
    expect(PartRequirementWorkflow.isTransitionAllowed("pending", "issued")).toBe(false);
    expect(PartRequirementWorkflow.isTransitionAllowed("pending", "ordered")).toBe(false);
    expect(PartRequirementWorkflow.isTransitionAllowed("approved", "received")).toBe(false);
    expect(PartRequirementWorkflow.isTransitionAllowed("received", "cancelled")).toBe(false);
    expect(PartRequirementWorkflow.isTransitionAllowed("issued", "fulfilled")).toBe(false);
  });

  it("marque issued, fulfilled, cancelled et rejected comme finaux", () => {
    expect(PartRequirementWorkflow.isFinalStatus("issued")).toBe(true);
    expect(PartRequirementWorkflow.isFinalStatus("fulfilled")).toBe(true);
    expect(PartRequirementWorkflow.isFinalStatus("cancelled")).toBe(true);
    expect(PartRequirementWorkflow.isFinalStatus("rejected")).toBe(true);
    expect(PartRequirementWorkflow.isFinalStatus("pending")).toBe(false);
    expect(PartRequirementWorkflow.isFinalStatus("received")).toBe(false);
    expect(PartRequirementWorkflow.isActiveStatus("received")).toBe(true);
    expect(PartRequirementWorkflow.isActiveStatus("issued")).toBe(false);
  });

  it("décrit la sortie de stock avec le vocabulaire magasin", () => {
    expect(
      PartRequirementWorkflow.getTransitionDescription("received", "issued"),
    ).toBe("Sortir la pièce du stock");
  });
});

describe("PartRequirementWorkflow — RBAC par rôle", () => {
  const cases: Array<{
    from: PartRequirementStatus;
    to: PartRequirementStatus;
    role: string;
    allowed: boolean;
  }> = [
    { from: "pending", to: "approved", role: "admin", allowed: true },
    { from: "pending", to: "approved", role: "workshop_manager", allowed: true },
    { from: "pending", to: "approved", role: "secretary", allowed: true },
    { from: "pending", to: "approved", role: "warehouse", allowed: false },
    { from: "pending", to: "approved", role: "technician", allowed: false },

    { from: "pending", to: "cancelled", role: "technician", allowed: false },
    { from: "pending", to: "cancelled", role: "secretary", allowed: false },

    { from: "approved", to: "ordered", role: "warehouse", allowed: true },
    { from: "approved", to: "ordered", role: "secretary", allowed: true },
    { from: "approved", to: "ordered", role: "workshop_manager", allowed: false },
    { from: "approved", to: "ordered", role: "technician", allowed: false },

    { from: "ordered", to: "received", role: "warehouse", allowed: true },
    { from: "ordered", to: "received", role: "secretary", allowed: true },
    { from: "ordered", to: "received", role: "workshop_manager", allowed: false },

    { from: "received", to: "issued", role: "warehouse", allowed: true },
    { from: "received", to: "issued", role: "admin", allowed: true },
    { from: "received", to: "issued", role: "secretary", allowed: false },
    { from: "received", to: "issued", role: "technician", allowed: false },
    { from: "received", to: "issued", role: "workshop_manager", allowed: false },

    { from: "cancel_requested", to: "cancelled", role: "admin", allowed: true },
    { from: "cancel_requested", to: "cancelled", role: "workshop_manager", allowed: false },
    { from: "cancel_requested", to: "approved", role: "admin", allowed: true },
  ];

  it.each(cases)(
    "$role $from -> $to : $allowed",
    ({ from, to, role, allowed }) => {
      expect(PartRequirementWorkflow.isUserAuthorized(from, to, role)).toBe(allowed);

      const result = validate(from, to, role, OTHER_USER);
      expect(result.valid).toBe(allowed);
      if (!allowed) {
        expect(result.error).toBeTruthy();
      }
    },
  );

  it("filtre getNextPossibleStatuses selon le rôle, sans contrôle d'identité", () => {
    expect(PartRequirementWorkflow.getNextPossibleStatuses("received", "warehouse")).toEqual([
      "issued",
    ]);
    expect(PartRequirementWorkflow.getNextPossibleStatuses("received", "technician")).toEqual([]);
    expect(PartRequirementWorkflow.getNextPossibleStatuses("pending", "secretary")).toEqual([
      "approved",
      "rejected",
    ]);
    expect(
      PartRequirementWorkflow.getNextPossibleStatuses("pending", "workshop_manager"),
    ).toEqual(["approved", "rejected", "cancelled"]);
  });
});

describe("PartRequirementWorkflow — identité et séparation des tâches", () => {
  it("exige requesterId et currentUserId pour une transition sensible (non-admin)", () => {
    expect(validate("pending", "approved", "workshop_manager").valid).toBe(false);
    expect(validate("pending", "approved", "workshop_manager", { requesterId: 1 }).valid).toBe(
      false,
    );
    expect(validate("pending", "approved", "workshop_manager", { currentUserId: 2 }).valid).toBe(
      false,
    );
    expect(validate("pending", "approved", "workshop_manager", OTHER_USER).valid).toBe(true);
  });

  it("laisse l'admin bypasser le contrôle d'identité", () => {
    expect(validate("pending", "approved", "admin").valid).toBe(true);
    expect(validate("received", "issued", "admin").valid).toBe(true);
  });

  it("interdit d'approuver sa propre demande", () => {
    const result = validate("pending", "approved", "workshop_manager", SAME_USER);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/propre demande/i);
  });

  it("interdit de rejeter sa propre demande", () => {
    const result = validate("pending", "rejected", "secretary", SAME_USER);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/propre demande/i);
  });

  it("autorise un autre utilisateur du bon rôle à approuver", () => {
    expect(validate("pending", "approved", "workshop_manager", OTHER_USER).valid).toBe(true);
    expect(validate("pending", "approved", "secretary", OTHER_USER).valid).toBe(true);
  });

  it("refuse l'annulation au technicien demandeur, même en pending (PATCH réservé à isInventoryManager)", () => {
    expect(validate("pending", "cancelled", "technician", SAME_USER).valid).toBe(false);
  });

  it("l'admin peut confirmer l'annulation même s'il était le demandeur", () => {
    expect(validate("cancel_requested", "cancelled", "admin", SAME_USER).valid).toBe(true);
  });

  it("le magasinier peut réceptionner même s'il était le demandeur", () => {
    expect(validate("ordered", "received", "warehouse", SAME_USER).valid).toBe(true);
  });
});

describe("PartRequirementWorkflow — secretary vs workshop_manager", () => {
  const createdByManager = {
    ...OTHER_USER,
    requesterRole: "workshop_manager",
  };

  it("seule la secrétaire valide une demande créée par un chef d'atelier", () => {
    const secretary = validate("pending", "approved", "secretary", createdByManager);
    expect(secretary.valid).toBe(true);

    const manager = validate("pending", "approved", "workshop_manager", createdByManager);
    expect(manager.valid).toBe(false);
    expect(manager.error).toMatch(/secrétaire/i);

    const warehouse = validate("pending", "approved", "warehouse", createdByManager);
    expect(warehouse.valid).toBe(false);
  });

  it("seule la secrétaire peut rejeter une demande créée par un chef d'atelier", () => {
    expect(validate("pending", "rejected", "secretary", createdByManager).valid).toBe(true);
    expect(validate("pending", "rejected", "workshop_manager", createdByManager).valid).toBe(
      false,
    );
    expect(validate("pending", "rejected", "admin", createdByManager).valid).toBe(false);
  });

  it("un chef d'atelier peut valider une demande d'un autre rôle", () => {
    const result = validate("pending", "approved", "workshop_manager", {
      ...OTHER_USER,
      requesterRole: "technician",
    });
    expect(result.valid).toBe(true);
  });
});

describe("PartRequirementWorkflow — libellés alignés sur la source unique", () => {
  it("réexporte PART_REQUIREMENT_STATUS_LABELS sans table locale", () => {
    expect(STATUS_LABELS).toBe(PART_REQUIREMENT_STATUS_LABELS);
  });
});

describe("Sortie exceptionnelle (dérogation chef d'atelier)", () => {
  const motifValide = "Magasin fermé samedi soir, camion immobilisé";

  it("autorise le chef d'atelier avec un motif écrit", () => {
    expect(
      PartRequirementWorkflow.validateOverrideIssue("workshop_manager", motifValide).valid,
    ).toBe(true);
  });

  it("refuse le technicien même avec un motif", () => {
    // Le demandeur ne se sert pas lui-même: c'est tout l'objet du garde-fou.
    const verdict = PartRequirementWorkflow.validateOverrideIssue("technician", motifValide);
    expect(verdict.valid).toBe(false);
    expect(verdict.error).toMatch(/chef d'atelier/i);
  });

  it("refuse un motif vide, blanc ou trop court", () => {
    for (const motif of [undefined, "", "   ", "ok", "rien à signaler".slice(0, 5)]) {
      expect(
        PartRequirementWorkflow.validateOverrideIssue("workshop_manager", motif).valid,
      ).toBe(false);
    }
  });

  it("n'élargit PAS la règle normale: le chef d'atelier ne sort toujours pas de plein droit", () => {
    // La dérogation est un chemin nommé à côté, pas un droit supplémentaire.
    expect(
      PartRequirementWorkflow.isUserAuthorized("received", "issued", "workshop_manager"),
    ).toBe(false);
    expect(
      PartRequirementWorkflow.validateTransition("received", "issued", "workshop_manager", {
        currentUserId: 1,
      }).valid,
    ).toBe(false);
  });
});
