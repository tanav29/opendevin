"use client";

import { Children, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : "";
    })
    .join("");
}

function ResponseCode({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock className="my-3">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "Code"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} aria-label="Copy code" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96">
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export function Response({ children }: { children: string }) {
  return (
    <div className="typeset typeset-docs min-w-0 break-words text-sm leading-6">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre({ children }) {
            const child = Children.toArray(children)[0];
            const language = isValidElement<{ className?: string }>(child)
              ? (/language-(\S+)/.exec(child.props.className ?? "")?.[1] ?? "")
              : "";
            return (
              <ResponseCode code={textContent(children).replace(/\n$/, "")} language={language} />
            );
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
