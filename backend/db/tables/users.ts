import { getPool } from "../index.js";
import type { Pool, PoolClient } from "pg";

export interface User {
  userId: number;
  email: string;
  pendingEmail: string | null;
  username: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  usernameChangedAt: Date | null;
  emailChangeRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const USER_COLUMNS =
  `user_id, email, pending_email, username, password_hash, email_verified_at,
   username_changed_at, email_change_requested_at, created_at, updated_at`;
type Queryable = Pick<Pool | PoolClient, "query">;

function mapUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return {
    userId: row.user_id as number,
    email: row.email as string,
    pendingEmail: (row.pending_email as string | null) ?? null,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    emailVerifiedAt: row.email_verified_at as Date | null,
    usernameChangedAt: row.username_changed_at as Date | null,
    emailChangeRequestedAt: row.email_change_requested_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createUser(
  email: string,
  username: string,
  passwordHash: string,
  db: Queryable = getPool(),
): Promise<User> {
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash)
     VALUES (LOWER($1), $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [email, username, passwordHash],
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

export async function findUserByUsername(username: string): Promise<User | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS} FROM users WHERE LOWER(username) = LOWER($1)`,
    [username],
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

export async function updateUsername(userId: number, username: string, db: Queryable = getPool()): Promise<User | null> {
  const { rows } = await db.query(
    `UPDATE users
     SET username = $2, username_changed_at = NOW(), updated_at = NOW()
     WHERE user_id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, username],
  );
  return mapUser(rows[0]);
}

export async function requestEmailChange(
  userId: number,
  pendingEmail: string,
  db: Queryable = getPool(),
): Promise<User | null> {
  const { rows } = await db.query(
    `UPDATE users
     SET pending_email = LOWER($2), email_change_requested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, pendingEmail],
  );
  return mapUser(rows[0]);
}

export async function clearPendingEmailChange(userId: number, db: Queryable = getPool()): Promise<void> {
  await db.query(
    `UPDATE users
     SET pending_email = NULL, email_change_requested_at = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );
}

export async function findUserByAnyEmail(
  email: string,
  excludeUserId?: number,
  db: Queryable = getPool(),
): Promise<User | null> {
  const { rows } = excludeUserId
    ? await db.query(
        `SELECT ${USER_COLUMNS}
         FROM users
         WHERE (LOWER(email) = LOWER($1) OR LOWER(pending_email) = LOWER($1))
           AND user_id <> $2
         LIMIT 1`,
        [email, excludeUserId],
      )
    : await db.query(
        `SELECT ${USER_COLUMNS}
         FROM users
         WHERE LOWER(email) = LOWER($1) OR LOWER(pending_email) = LOWER($1)
         LIMIT 1`,
        [email],
      );
  return mapUser(rows[0]);
}

export async function updateUserPasswordHash(
  userId: number,
  passwordHash: string,
  db: Queryable = getPool(),
): Promise<User | null> {
  const { rows } = await db.query(
    `UPDATE users
     SET password_hash = $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, passwordHash],
  );
  return mapUser(rows[0]);
}
