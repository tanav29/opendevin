"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Names the action, so the button matches the verb the user clicked. */
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

/**
 * Promise-based replacement for `window.confirm`, so destructive actions get
 * a styled dialog that names what will happen.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const settled = useRef(true);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settled.current = false;
        setPending({ options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      if (settled.current) return;
      settled.current = true;
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {pending && (
          <AlertDialogContent>
            <AlertDialogTitle>{pending.options.title}</AlertDialogTitle>
            {pending.options.description && (
              <AlertDialogDescription>
                {pending.options.description}
              </AlertDialogDescription>
            )}
            <AlertDialogFooter>
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {pending.options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                autoFocus
                size="sm"
                variant={pending.options.destructive ? "destructive" : "default"}
                onClick={() => settle(true)}
              >
                {pending.options.confirmLabel ?? "Confirm"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}
