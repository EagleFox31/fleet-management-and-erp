-- Cache dashboard Direction retiré (août 2026) — voir 20260830_drop_management_dashboard_cache.sql.
-- Historique : cette migration avait créé management_daily_metrics + triggers ;
-- le plancher mesuré (~475 ms) est la latence Neon, pas l'agrégation SQL.

SELECT 1;
