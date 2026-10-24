"use client";

import { Badge } from "@/components/ui/badge";

// Shared sandbox/agent/result badges so Bot and session headers stay consistent.
export default function ChatStatusBadges({
  sandbox,
  agent,
  result,
}: {
  sandbox: string;
  agent: string;
  result?: string;
}) {
  return (
    <div className="hidden items-center gap-1.5 lg:flex" aria-live="polite">
      <Badge variant="outline">Sandbox: {sandbox.replace("-", " ")}</Badge>
      <Badge variant="outline">Agent: {agent}</Badge>
      {result ? <Badge variant="outline">Result: {result}</Badge> : null}
    </div>
  );
}
