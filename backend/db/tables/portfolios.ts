import { getPool } from "../index.js";

/** Starting LP granted to new accounts. NUMERIC string to match pg driver output. */
export const STARTING_LP = "50000.00";

export interface Portfolio {
  portfolioId: number;
  userId: number;
  /** NUMERIC(18,2) returned as a string by the pg driver to preserve precision. */
  lpBalance: string;
  createdAt: Date;
  updatedAt: Date;
}

const PORTFOLIO_COLUMNS = "portfolio_id, user_id, lp_balance, created_at, updated_at";

function mapPortfolio(row: Record<string, unknown> | undefined): Portfolio | null {
  if (!row) return null;
  return {
    portfolioId: row.portfolio_id as number,
    userId: row.user_id as number,
    lpBalance: row.lp_balance as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createPortfolio(userId: number): Promise<Portfolio> {
  const { rows } = await getPool().query(
    `INSERT INTO portfolios (user_id, lp_balance) VALUES ($1, $2)
     RETURNING ${PORTFOLIO_COLUMNS}`,
    [userId, STARTING_LP],
  );
  return mapPortfolio(rows[0]) as Portfolio;
}

export async function findPortfolioByUserId(userId: number): Promise<Portfolio | null> {
  const { rows } = await getPool().query(
    `SELECT ${PORTFOLIO_COLUMNS} FROM portfolios WHERE user_id = $1`,
    [userId],
  );
  return mapPortfolio(rows[0]);
}
