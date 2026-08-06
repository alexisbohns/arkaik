import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The repo's field group — uppercase micro-label, control, optional hint —
 * promoted out of `PromptBuilderForm`'s private `Field` (audit `factorization-2`,
 * `shadcn-4`). It was hand-rolled ~30 times across every form dialog and panel.
 *
 * **The a11y half is the reason this exists, not the dedup.** Those 30 copies
 * split three ways: a `<span>` over a control with no accessible name at all, a
 * `<label>` with no `htmlFor` (which announces nothing and does not focus its
 * control on click), and a handful that got it right. Passing `htmlFor` here —
 * with the matching `id` on the `Input`, `Textarea` or `SelectTrigger` — is the
 * whole fix, and `SelectTrigger` accepts `id` for exactly this reason.
 *
 * When `htmlFor` is omitted the label renders as a `<span>`, deliberately: a
 * `<label>` pointing at nothing is an a11y lie that reads as done work. A field
 * whose control cannot take an id (an editable `contentEditable` region, a
 * button group) keeps its own `aria-label` and gets an honest `<span>` here.
 *
 * The label class exists in two orderings across the repo —
 * `text-muted-foreground uppercase tracking-wide` (34 hits, panels) and
 * `uppercase tracking-wide text-muted-foreground` (15 hits, maps/settings/
 * delivery). They render identically; this takes the dominant first ordering so
 * a grep for the panel spelling keeps finding the canonical one.
 */

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground uppercase tracking-wide";

interface FieldProps {
  label: ReactNode;
  /** Explanatory line under the control — the `text-xs text-muted-foreground` note. */
  hint?: ReactNode;
  /** `id` of the control this labels. Supply it whenever the control can take one. */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
          {label}
        </Label>
      ) : (
        <span className={FIELD_LABEL_CLASS}>{label}</span>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { FIELD_LABEL_CLASS };
