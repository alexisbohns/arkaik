"use client";

import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCopyId } from "@/lib/hooks/useCopyId";

interface CopyButtonProps {
  /** What goes on the clipboard. */
  text: string;
  /** The button's words, which do not change: "Copy the prompt". */
  label: string;
  /** Names the text in the toast, which would otherwise print it whole: "the prompt" → "Copied the prompt". */
  what: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default";
  className?: string;
}

/**
 * Every Arkademy copy action (the baseline prompt here; the paragraph and the
 * Markdown in part 4). `useCopyId` does the copying: the icon turns to a check
 * for a moment and a toast names what was copied, or says the copy failed.
 */
export function CopyButton({ text, label, what, variant = "outline", size = "sm", className }: CopyButtonProps) {
  const { copied, copy } = useCopyId(text, what);
  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className}>
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {label}
    </Button>
  );
}
