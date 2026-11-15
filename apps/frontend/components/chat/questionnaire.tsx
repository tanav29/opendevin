"use client";

import { Questionnaire } from "@shadcn/react/questionnaire";
import { buttonVariants } from "@/components/ui/button";

export type Question = { question: string; options: string[]; answered: boolean };

export function parseQuestion(content: string): Question | null {
  const match = [...content.matchAll(/<div data-question='(.*)'>/g)].at(-1);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1].replace(/&#39;/g, "'"));
    if (!value || typeof value.question !== "string") return null;
    return {
      question: value.question,
      options: Array.isArray(value.options)
        ? value.options.filter((option: unknown): option is string => typeof option === "string")
        : [],
      answered: value.answered === true,
    };
  } catch {
    return null;
  }
}

export default function ChatQuestionnaire({
  question,
  disabled = false,
  onSubmit,
}: {
  question: Question;
  disabled?: boolean;
  onSubmit: (answer: string) => void;
}) {
  const items = [
    { name: "answer", required: true, choices: question.options.map((value) => ({ value })) },
  ];

  return (
    <Questionnaire.Root
      items={items}
      aria-label="Questionnaire"
      className="mx-auto max-h-[min(32rem,60dvh)] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const answer = String(new FormData(event.currentTarget).get("answer") ?? "").trim();
        if (answer && !disabled) onSubmit(answer);
      }}
    >
      <p className="mb-3 text-xs font-medium text-muted-foreground" role="status">
        Waiting for your answer
      </p>
      <Questionnaire.Item name="answer" required disabled={disabled} className="min-w-0">
        <Questionnaire.Title className="text-sm font-medium leading-6">
          {question.question}
        </Questionnaire.Title>
        <Questionnaire.Description className="mt-1 text-xs text-muted-foreground">
          Choose an option or write your own answer.
        </Questionnaire.Description>
        <Questionnaire.Choices className="mt-3 space-y-2">
          {question.options.map((option) => (
            <Questionnaire.Choice
              key={option}
              value={option}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring data-checked:border-primary data-checked:bg-muted data-disabled:cursor-default data-disabled:opacity-50"
            >
              <Questionnaire.ChoiceInput className="size-4 shrink-0 accent-primary" />
              <Questionnaire.ChoiceLabel className="min-w-0 break-words">
                {option}
              </Questionnaire.ChoiceLabel>
            </Questionnaire.Choice>
          ))}
          <Questionnaire.Input
            aria-label="Your answer"
            placeholder="Write your own answer…"
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </Questionnaire.Choices>
        <Questionnaire.Error className="mt-2 text-xs text-destructive" />
      </Questionnaire.Item>
      <div className="mt-3 flex justify-end">
        <Questionnaire.Submit disabled={disabled} className={buttonVariants()}>
          Submit answer
        </Questionnaire.Submit>
      </div>
    </Questionnaire.Root>
  );
}
