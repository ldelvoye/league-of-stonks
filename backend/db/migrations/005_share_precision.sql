ALTER TABLE portfolio_positions
  ALTER COLUMN shares TYPE NUMERIC(18, 3)
  USING ROUND(shares, 3);

ALTER TABLE portfolio_trades
  ALTER COLUMN shares TYPE NUMERIC(18, 3)
  USING ROUND(shares, 3);
