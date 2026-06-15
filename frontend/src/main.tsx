import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./state/AuthContext";
import { ToastProvider } from "./state/ToastContext";
import { SessionExpiredError } from "../lib/api";
import { queryKeys } from "./queries/keys";

// When any query or mutation throws SessionExpiredError, clear the auth cache
// so AuthContext recognises the user as signed out. Route guards in App.tsx
// will redirect to /login once the user state becomes null.
function handleSessionExpiry(error: unknown, client: QueryClient) {
  if (error instanceof SessionExpiredError) {
    void client.invalidateQueries({ queryKey: queryKeys.auth.me() });
  }
}

function createQueryClient(): QueryClient {
  let client!: QueryClient;
  const onCacheError = (error: unknown): void => {
    handleSessionExpiry(error, client);
  };

  client = new QueryClient({
    queryCache: new QueryCache({
      onError: onCacheError,
    }),
    mutationCache: new MutationCache({
      onError: onCacheError,
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  });

  return client;
}

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
