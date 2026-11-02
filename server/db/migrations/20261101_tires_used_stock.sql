-- Stock pneu : les pneus démontés remis en stock sont comptés en usagé, à part du neuf.
-- Rejoué automatiquement au démarrage via server/init-database.ts, qui porte les mêmes ordres.
-- Rétroactif : le stock existant reste compté neuf (aucun backfill, l'origine n'a pas été conservée) ;
-- les montages existants sont réputés pris dans le neuf.

ALTER TABLE tires ADD COLUMN IF NOT EXISTS used_stock_quantity integer NOT NULL DEFAULT 0;

ALTER TABLE vehicle_tires ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'new';
