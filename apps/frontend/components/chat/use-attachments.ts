"use client";

import { useState } from "react";
import { toast } from "sonner";

export type Attachment = { id: string; name: string; content: string };

export const MAX_ATTACHMENT_COUNT = 3;
export const MAX_MESSAGE_CHARS = 20_000;

export function serializeAttachments(attachments: Attachment[]) {
  return attachments
    .map(
      (attachment) =>
        `<attachment name="${attachment.name}">\n${attachment.content}\n</attachment>`,
    )
    .join("\n\n");
}

// Text attachments are pasted into the message for both Bot and session chats.
export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  async function addFiles(files: FileList | File[]) {
    const all = Array.from(files);
    const remaining = Math.max(0, MAX_ATTACHMENT_COUNT - attachments.length);
    if (remaining === 0) {
      toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
      return;
    }
    const list = all.slice(0, remaining);
    if (all.length > list.length) {
      toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
    }
    let nextAttachments = [...attachments];
    for (const file of list) {
      if (file.size > 200_000) {
        toast.error(`Attachment ${file.name} too large (max 200KB).`);
        continue;
      }
      try {
        const text = await file.text();
        const next = [
          ...nextAttachments,
          { id: crypto.randomUUID(), name: file.name.slice(0, 100), content: text },
        ];
        if (serializeAttachments(next).length > MAX_MESSAGE_CHARS) {
          toast.error(
            `Attachments exceed the ${MAX_MESSAGE_CHARS.toLocaleString()}-character message limit.`,
          );
          continue;
        }
        nextAttachments = next;
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }
    setAttachments(nextAttachments);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function resetAttachments() {
    setAttachments([]);
  }

  return { attachments, addFiles, removeAttachment, resetAttachments };
}
