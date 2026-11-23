"use client";

import { Button } from "@oncobase/ui/button";
import { Field, FieldLabel } from "@oncobase/ui/field";
import { Textarea } from "@oncobase/ui/textarea";
import type { ChatStatus } from "ai";
import { CornerDownLeftIcon, Loader2Icon, SquareIcon, XIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent, Ref } from "react";

const GROUP_CLASS =
  "relative flex h-auto w-full min-w-0 flex-col items-center overflow-hidden rounded-lg border transition-colors outline-none has-disabled:opacity-50";
const GROUP_DEFAULT_CLASS =
  "border-input has-disabled:bg-input/50 has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/80";
const GROUP_FLAT_CLASS =
  "border-[var(--sidebar-border)] bg-white shadow-sm has-[textarea:focus-visible]:border-[var(--brand)] dark:border-neutral-700 dark:bg-neutral-800";
const TEXTAREA_CLASS =
  "flex field-sizing-content max-h-48 min-h-16 w-full flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-base shadow-none ring-0 transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50 md:text-sm dark:bg-transparent dark:disabled:bg-transparent";
const FOOTER_CLASS =
  "order-last flex h-auto w-full cursor-text items-center justify-between gap-1 px-2.5 py-1.5 pb-2 text-sm font-medium text-muted-foreground select-none";
const SUBMIT_CLASS =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-[var(--brand)] bg-clip-padding p-0 text-sm font-medium whitespace-nowrap text-white shadow-none transition-all outline-none select-none hover:bg-[var(--brand)]/90 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:bg-[var(--brand)] disabled:text-white disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export type ChatComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void | Promise<unknown>;
  onStop: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  status: ChatStatus;
  placeholder: string;
  flat?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
};

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  onKeyDown,
  status,
  placeholder,
  flat = false,
  textareaRef,
}: ChatComposerProps) {
  const isGenerating = status === "submitted" || status === "streaming";

  let icon = <CornerDownLeftIcon className="size-4" aria-hidden="true" />;
  if (status === "submitted") {
    icon = <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  } else if (status === "streaming") {
    icon = <SquareIcon className="size-4" aria-hidden="true" />;
  } else if (status === "error") {
    icon = <XIcon className="size-4" aria-hidden="true" />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    Promise.resolve(onSubmit(value)).catch(() => {
      // Keep the text so the user can retry.
    });
  };

  return (
    <form className="w-full" data-test-id="chat-composer" onSubmit={handleSubmit}>
      <Field className={`${GROUP_CLASS} ${flat ? GROUP_FLAT_CLASS : GROUP_DEFAULT_CLASS}`}>
        <FieldLabel className="sr-only">Message</FieldLabel>
        <Textarea
          autoFocus
          ref={textareaRef}
          value={value}
          onValueChange={(next) => onValueChange(next)}
          onKeyDown={onKeyDown}
          submitShortcut="enter"
          name="message"
          placeholder={placeholder}
          className={TEXTAREA_CLASS}
          data-test-id="chat-composer-textarea"
        />
        <div className={FOOTER_CLASS}>
          <span className="flex-1" />
          {isGenerating ? (
            <Button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className={SUBMIT_CLASS}
              data-test-id="chat-submit-button"
            >
              {icon}
            </Button>
          ) : (
            <Button
              type="submit"
              aria-label="Submit"
              disabled={!value.trim()}
              className={SUBMIT_CLASS}
              data-test-id="chat-submit-button"
            >
              {icon}
            </Button>
          )}
        </div>
      </Field>
    </form>
  );
}
