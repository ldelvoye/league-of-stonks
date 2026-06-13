import type { RiotId } from "../lib/types.js";

export type AccountGuestMode = "login" | "register";
export type AccountEditField = "username" | "email";

export type AppRoute =
  | { kind: "home" }
  | { kind: "account"; guestMode: AccountGuestMode }
  | { kind: "accountEdit"; field: AccountEditField }
  | { kind: "welcome" }
  | { kind: "verifyEmail"; token: string | null }
  | { kind: "resetPassword"; token: string | null }
  | { kind: "player"; riotId: RiotId };

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function buildPlayerRoute(gameName: string, tagLine: string): string {
  return `/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
}

export function parseRoute(pathname: string, search: string): AppRoute {
  const normalized = normalizePath(pathname);

  if (normalized === "/login" || normalized === "/account") {
    return { kind: "account", guestMode: "login" };
  }
  if (normalized === "/account/username") {
    return { kind: "accountEdit", field: "username" };
  }
  if (normalized === "/account/email") {
    return { kind: "accountEdit", field: "email" };
  }
  if (normalized === "/register") {
    return { kind: "account", guestMode: "register" };
  }
  if (normalized === "/welcome") {
    return { kind: "welcome" };
  }
  if (normalized === "/verify-email") {
    const token = new URLSearchParams(search).get("token");
    return { kind: "verifyEmail", token: token?.trim() || null };
  }
  if (normalized === "/reset-password") {
    const token = new URLSearchParams(search).get("token");
    return { kind: "resetPassword", token: token?.trim() || null };
  }

  const playerMatch = normalized.match(/^\/player\/([^/]+)\/([^/]+)$/);
  if (playerMatch) {
    try {
      return {
        kind: "player",
        riotId: {
          gameName: decodeURIComponent(playerMatch[1]),
          tagLine: decodeURIComponent(playerMatch[2]),
        },
      };
    } catch {
      return { kind: "home" };
    }
  }

  return { kind: "home" };
}

export function isAppPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/login/" ||
    pathname === "/register" ||
    pathname === "/register/" ||
    pathname === "/account" ||
    pathname === "/account/" ||
    pathname === "/account/username" ||
    pathname === "/account/username/" ||
    pathname === "/account/email" ||
    pathname === "/account/email/" ||
    pathname === "/welcome" ||
    pathname === "/welcome/" ||
    pathname === "/verify-email" ||
    pathname === "/verify-email/" ||
    pathname === "/reset-password" ||
    pathname === "/reset-password/" ||
    /^\/player\/[^/]+\/[^/]+\/?$/.test(pathname)
  );
}
