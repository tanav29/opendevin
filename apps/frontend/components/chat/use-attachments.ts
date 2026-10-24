"use client";

import { useRef, useState } from "react";
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
  const attachmentsRef = useRef<Attachment[]>([]);
  const readGeneration = useRef(0);

  function commit(next: Attachment[]) {
    attachmentsRef.current = next;
    setAttachments(next);
  }

  async function addFiles(files: FileList | File[]) {
    const generation = readGeneration.current;
    const all = Array.from(files);
    if (attachmentsRef.current.length >= MAX_ATTACHMENT_COUNT) {
      toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
      return;
    }
    const added: Attachment[] = [];
    for (const file of all) {
      if (file.size > 200_000) {
        toast.error(`Attachment ${file.name} too large (max 200KB).`);
        continue;
      }
      try {
        const text = await file.text();
        added.push({ id: crypto.randomUUID(), name: file.name.slice(0, 100), content: text });
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }
    if (generation !== readGeneration.current) return;

    let next = [...attachmentsRef.current];
    for (const attachment of added) {
      if (next.length >= MAX_ATTACHMENT_COUNT) {
        toast.error(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added.`);
        break;
      }
      const candidate = [...next, attachment];
      if (serializeAttachments(candidate).length > MAX_MESSAGE_CHARS) {
        toast.error(
          `Attachments exceed the ${MAX_MESSAGE_CHARS.toLocaleString()}-character message limit.`,
        );
        continue;
      }
      next = candidate;
    }
    commit(next);
  }

  function removeAttachment(id: string) {
    commit(attachmentsRef.current.filter((attachment) => attachment.id !== id));
  }

  function resetAttachments() {
    readGeneration.current++;
    commit([]);
  }

  return { attachments, addFiles, removeAttachment, resetAttachments };
}
