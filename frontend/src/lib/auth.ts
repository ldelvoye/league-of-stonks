import { authErrorMessage } from "../../lib/api";
import type { ApiErrorBody } from "../../lib/types";

export function authFailureMessage(result: { status: number; data: unknown }): string {
  const body =
    result.data && typeof result.data === "object" && "error" in result.data
      ? (result.data as ApiErrorBody)
      : null;
  return authErrorMessage(result.status, body);
}

export function normalizeEmailForCompare(value: string): string {
  return value.trim().toLowerCase();
}
