"use client";

import { FileTextIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";

export function PromptAttachments({
  files,
  onRemove,
}: {
  files: { id: string; name: string }[];
  onRemove: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files">
      {files.map((file) => (
        <Attachment key={file.id} size="sm" className="min-w-0 max-w-full">
          <AttachmentMedia>
            <FileTextIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(file.id)}
            >
              <XIcon />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </div>
  );
}
