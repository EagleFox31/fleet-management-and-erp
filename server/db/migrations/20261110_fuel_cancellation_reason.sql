-- Motif d'annulation d'un plein validé (POST /api/fuel-records/:id/cancel).
-- Jumelle de server/init-database.ts. Idempotente.
ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS cancellation_reason text;
