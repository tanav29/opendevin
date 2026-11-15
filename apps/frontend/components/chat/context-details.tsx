"use client";

import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";

type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export function ContextDetails({ usage, model }: { usage?: Usage; model?: string }) {
  const total = usage?.totalTokens;
  const format = (value?: number) => (value == null ? "—" : value.toLocaleString());

  return (
    <Popover.Root>
      <Popover.Trigger render={<Button type="button" variant="outline" size="sm" />}>
        {total == null ? "Context" : `${format(total)} tokens`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md outline-none">
            <Popover.Title className="text-sm font-medium">Context details</Popover.Title>
            <p className="mt-1 text-xs text-muted-foreground">
              Token usage for the latest model request.
            </p>
            <dl className="mt-3 space-y-2 text-xs">
              {model && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="min-w-0 truncate" title={model}>
                    {model}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Input</dt>
                <dd>{format(usage?.inputTokens)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Output</dt>
                <dd>{format(usage?.outputTokens)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total</dt>
                <dd>{format(total)}</dd>
              </div>
            </dl>
            {total == null && (
              <p className="mt-3 text-xs text-muted-foreground">
                Usage is available after a completed request.
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
