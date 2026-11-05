import { Router, type NextFunction, type Request, type Response } from "express";
import {
  createTreasuryAccountSchema,
  createTreasuryEntrySchema,
  createTreasuryTransferSchema,
  currentTreasuryMonth,
  treasuryLedgerQuerySchema,
} from "@shared/contracts/treasury";
import { TREASURY_FUEL_CARD_READ_ROLES, TREASURY_READ_ROLES, TREASURY_WRITE_ROLES } from "@shared/constants/roles";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { parseRouteId } from "../lib/route-id";
import { authorize } from "../middleware/auth";
import { ledgerToCsv, treasuryService } from "../services/treasury-service";

/**
 * Journal de trésorerie (lot T1), derrière le drapeau `finance`. Saisie : administrateur et secrétariat ;
 * lecture : + direction ; logistique : compte carte carburant seul (lot T2). Contrat : shared/contracts/treasury.ts.
 */
const router = Router();
const finance = requireFeature("finance");
/** Logistique (lot T2) : lecture du seul compte carte carburant, pas des banques ni des caisses. */
const fuelCardOnly = (req: Request) => !(TREASURY_READ_ROLES as readonly string[]).includes(String(req.user?.role ?? ""));

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const currentMonth = () => currentTreasuryMonth();

router.get(
  "/treasury/accounts",
  finance,
  authorize([...TREASURY_FUEL_CARD_READ_ROLES]),
  handle(async (req, res) => {
    const accounts = await treasuryService.listAccounts();
    res.json(fuelCardOnly(req) ? accounts.filter((a) => a.kind === "fuel_card") : accounts);
  }),
);

router.post(
  "/treasury/accounts",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const input = createTreasuryAccountSchema.parse(req.body);
    const audit = { createdBy: req.user!.id };
    res.status(201).json(await treasuryService.createAccount(audit.createdBy, input));
  }),
);

router.get(
  "/treasury/accounts/:id/entries",
  finance,
  authorize([...TREASURY_FUEL_CARD_READ_ROLES]),
  handle(async (req, res) => {
    const accountId = parseRouteId(req.params.id, "Identifiant de compte invalide.");
    const query = treasuryLedgerQuerySchema.parse(req.query);
    const month = query.month ?? currentMonth();
    const ledger = await treasuryService.ledger(accountId, month);
    if (fuelCardOnly(req) && ledger.account.kind !== "fuel_card") throw new AppError(403, "Accès réservé au compte carte carburant.");
    if (query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tresorerie-${ledger.account.code}-${month}.csv"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(ledgerToCsv(ledger));
      return;
    }
    res.json(ledger);
  }),
);

router.post(
  "/treasury/entries",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const input = createTreasuryEntrySchema.parse(req.body);
    const audit = { createdBy: req.user!.id };
    const { entry, replayed } = await treasuryService.createEntry(audit.createdBy, input);
    res.status(replayed ? 200 : 201).json(entry);
  }),
);

router.post(
  "/treasury/transfers",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const input = createTreasuryTransferSchema.parse(req.body);
    const audit = { createdBy: req.user!.id };
    const { entries, replayed } = await treasuryService.createTransfer(audit.createdBy, input);
    res.status(replayed ? 200 : 201).json({ entries, replayed });
  }),
);

export default router;
