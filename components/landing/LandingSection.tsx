import Link from "next/link";
import type { ReactNode } from "react";
import { SOURCE_CAPTION, type Section } from "@/components/landing/content";
import { PreviewFrame } from "@/components/landing/PreviewFrame";
import { PREVIEW_META } from "@/components/landing/previews/ids";
import { Button } from "@/components/ui/button";

interface LandingSectionProps {
  section: Section;
  /** The preview element for this section, or null for `preview: "none"`. */
  preview: ReactNode;
}

/**
 * One feature, in the approved reading order (spec § Section unit): title,
 * the why in foreground colour, the preview (or the section's static cards)
 * as proof, its links, then what and how as two labelled columns. Copy arrives
 * in `section`; nothing here is literal marketing text.
 */
export function LandingSection({ section, preview }: LandingSectionProps) {
  const meta = section.preview === "none" ? null : PREVIEW_META[section.preview];
  return (
    <section id={section.id} className="min-w-0 scroll-mt-24">
      <h3 className="text-xl font-semibold tracking-tight">{section.title}</h3>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground">{section.why}</p>
      {meta && preview !== null && (
        <div className="mt-5">
          <PreviewFrame breadcrumb={meta.breadcrumb} height={meta.height} caption={SOURCE_CAPTION[meta.source]}>
            {preview}
          </PreviewFrame>
        </div>
      )}
      {section.cards && section.cards.length > 0 && (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {section.cards.map((card) => (
            <li key={card.kicker} className="rounded-[calc(var(--radius)+2px)] border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{card.kicker}</p>
              <p className="mt-1 text-sm font-semibold">{card.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
            </li>
          ))}
        </ul>
      )}
      {section.links && section.links.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {section.links.map((link) => (
            <Button key={link.href} asChild size={link.primary ? "lg" : "default"} variant={link.primary ? "default" : "outline"}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
              ) : (
                <Link href={link.href}>{link.label}</Link>
              )}
            </Button>
          ))}
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
