import type { ReactNode } from "react";
import type { Section } from "@/components/landing/content";
import { PreviewFrame } from "@/components/landing/PreviewFrame";
import { PREVIEW_META, SOURCE_CAPTION } from "@/components/landing/previews/ids";

interface LandingSectionProps {
  section: Section;
  /** The preview element for this section, or null for `preview: "none"`. */
  preview: ReactNode;
}

/**
 * One feature, in the approved reading order (spec § Section unit): title,
 * the why in foreground colour, the preview as proof, then what and how as
 * two labelled columns. Copy arrives in `section`; nothing here is literal
 * marketing text.
 */
export function LandingSection({ section, preview }: LandingSectionProps) {
  const meta = section.preview === "none" ? null : PREVIEW_META[section.preview];
  return (
    <section id={section.id} className="scroll-mt-24">
      <h3 className="text-xl font-semibold tracking-tight">{section.title}</h3>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground">{section.why}</p>
      {meta && preview !== null && (
        <div className="mt-5">
          <PreviewFrame breadcrumb={meta.breadcrumb} height={meta.height} caption={SOURCE_CAPTION[meta.source]}>
            {preview}
          </PreviewFrame>
        </div>
      )}
      <dl className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">What</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.what}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">How</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.how}</dd>
        </div>
      </dl>
    </section>
  );
}
