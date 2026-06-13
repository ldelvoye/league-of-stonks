import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthUser } from "../../lib/types";
import { getMe } from "../../lib/api";

const AUTH_ME_QUERY_KEY = ["auth", "me"] as const;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: async (): Promise<AuthUser | null> => {
      const result = await getMe();
      if (!result.ok || !result.data) return null;
      return result.data;
    },
    staleTime: 60_000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isPending,
      setUser(user) {
        queryClient.setQueryData(AUTH_ME_QUERY_KEY, user);
      },
      async refreshSession() {
        await queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY });
      },
    }),
    [meQuery.data, meQuery.isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
