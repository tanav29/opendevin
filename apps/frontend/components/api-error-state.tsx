"use client";

import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ApiError, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ApiErrorState({
  error,
  title = "Something is unavailable",
  description,
  onRetry,
  compact = false,
  className,
}: {
  error: unknown;
  title?: string;
  description?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const message = isApiError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card",
        compact ? "p-3" : "p-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description || message}</p>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <IconRefresh className="size-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function isNotFoundError(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

export function asApiError(error: unknown): ApiError {
  return isApiError(error) ? error : new ApiError(0, "The request could not be completed.");
}
