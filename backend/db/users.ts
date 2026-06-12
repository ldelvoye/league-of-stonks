import { getPool } from "./index.js";

export interface User {
  userId: number;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const USER_COLUMNS =
  "user_id, email, password_hash, email_verified_at, created_at, updated_at";

function mapUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return {
    userId: row.user_id as number,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    emailVerifiedAt: row.email_verified_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const { rows } = await getPool().query(
    `INSERT INTO users (email, password_hash)
     VALUES (LOWER($1), $2)
     RETURNING ${USER_COLUMNS}`,
    [email, passwordHash],
  );
  return mapUser(rows[0]) as User;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = LOWER($1)`,
    [email],
  );
  return mapUser(rows[0]);
}

export async function findUserById(userId: number): Promise<User | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE user_id = $1`,
    [userId],
  );
  return mapUser(rows[0]);
}
