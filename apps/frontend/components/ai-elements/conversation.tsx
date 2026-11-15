"use client";

import type { ReactNode } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

export function Conversation({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className={className}>
        <MessageScrollerViewport className="chat-scroll px-4 sm:px-6">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 py-6">
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Scroll to latest message" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
