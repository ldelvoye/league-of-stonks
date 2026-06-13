import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface ToastContextValue {
  toastMessage: string | null;
  showToast: (message: string) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const value = useMemo<ToastContextValue>(
    () => ({
      toastMessage,
      showToast(message) {
        setToastMessage(message);
      },
      hideToast() {
        setToastMessage(null);
      },
    }),
    [toastMessage],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
