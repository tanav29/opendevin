"use client";

import { useState, type ReactNode } from "react";
import { IconCopy, IconPlayerStop, IconRefresh, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { formatDate, type SessionDetail, type SessionStatus } from "./lib";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium">{value || "—"}</dd>
    </div>
  );
}

function CompactValue({ value, onCopy }: { value: string; onCopy: (value: string) => void }) {
  if (!value) return <span>—</span>;
  const visible = value.length > 5 ? `${value.slice(0, 5)}…` : value;
  return (
    <span className="inline-flex max-w-full items-center justify-end gap-1">
      <span className="truncate font-mono" title={value}>
        {visible}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${value}`}
        onClick={() => onCopy(value)}
      >
        <IconCopy />
      </Button>
    </span>
  );
}

export default function SessionInfo({
  sessionId,
  detail,
  status,
  onReconnect,
  onKill,
  reconnecting,
  killing,
  onDelete,
  deleting,
}: {
  sessionId: string;
  detail: SessionDetail | null;
  status: SessionStatus | null;
  onReconnect: () => void;
  onKill: () => void;
  reconnecting: boolean;
  killing: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const sandboxStatus =
    status?.lifecycle?.provisioning || status?.sandboxStatus || detail?.sandboxStatus || "pending";
  const agentStatus = status?.lifecycle?.agent || status?.status || detail?.status || "idle";
  const verification = status?.lifecycle?.verification || "pending";
  const plan = status?.plan || [];
  const usage = status?.usage;
  const createdAt = detail?.createdAt || status?.createdAt;
  const [copied, setCopied] = useState("");
  const sandboxId = status?.sandboxId || detail?.sandboxId || "";
  const canReconnect =
    sandboxStatus === "error" ||
    sandboxStatus === "unavailable" ||
    (status?.sandboxStatus === "ready" && !status?.sandboxAvailable);

  function copyValue(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(""), 1400);
    });
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <h2 className="text-sm font-medium">Session information</h2>
      <div className="space-y-4">
        <section className="rounded-lg border bg-muted/20 px-3">
          <h3 className="border-b border-border/60 py-2 text-xs font-medium text-muted-foreground">
            Session
          </h3>
          <dl>
            <InfoRow
              label="Session ID"
              value={<CompactValue value={sessionId} onCopy={copyValue} />}
            />
            <InfoRow
              label="Project"
              value={<CompactValue value={detail?.projectId || ""} onCopy={copyValue} />}
            />
            <InfoRow label="Branch" value={status?.branch || detail?.branch || ""} />
            <InfoRow label="Agent status" value={agentStatus} />
            <InfoRow label="Result" value={verification} />
            <InfoRow label="Model" value={status?.model || detail?.model || ""} />
          </dl>
        </section>
        <section className="rounded-lg border bg-muted/20 px-3">
          <h3 className="border-b border-border/60 py-2 text-xs font-medium text-muted-foreground">
            Workspace
          </h3>
          <dl>
            <InfoRow label="Sandbox" value={sandboxStatus} />
            <InfoRow
              label="Availability"
              value={status ? (status.sandboxAvailable ? "Connected" : "Unreachable") : ""}
            />
            <InfoRow
              label="Sandbox ID"
              value={<CompactValue value={sandboxId} onCopy={copyValue} />}
            />
            <InfoRow label="Path" value={status?.workspacePath || detail?.workspacePath || ""} />
            <InfoRow label="Repository" value={status?.repo || ""} />
          </dl>
        </section>
        <section className="rounded-lg border bg-muted/20 px-3">
          <h3 className="border-b border-border/60 py-2 text-xs font-medium text-muted-foreground">
            Activity
          </h3>
          <dl>
            <InfoRow label="Created" value={createdAt ? formatDate(createdAt) : ""} />
            <InfoRow
              label="Updated"
              value={detail?.updatedAt ? formatDate(detail.updatedAt) : ""}
            />
            <InfoRow
              label="Plan"
              value={
                plan.length
                  ? `${plan.filter((item) => item.status === "done").length}/${plan.length} complete`
                  : "No plan"
              }
            />
            <InfoRow
              label="Tokens"
              value={usage?.totalTokens ? usage.totalTokens.toLocaleString() : "—"}
            />
            <InfoRow label="Last error" value={status?.lastError || detail?.lastError || "None"} />
          </dl>
        </section>
      </div>
      <div className="space-y-3 border-t pt-4">
        <p role="status" className="text-xs text-muted-foreground">
          {copied ? "Copied full value" : "IDs are shortened for readability"}
        </p>
        <div className="flex flex-wrap gap-2">
          {canReconnect && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReconnect}
              disabled={reconnecting}
            >
              <IconRefresh /> {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
          )}
          {sandboxId && sandboxStatus !== "error" && sandboxStatus !== "unavailable" && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onKill}
              disabled={killing}
            >
              <IconPlayerStop /> {killing ? "Stopping…" : "Kill sandbox"}
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
          >
            <IconTrash /> {deleting ? "Deleting…" : "Delete session"}
          </Button>
        </div>
      </div>
    </div>
  );
}
