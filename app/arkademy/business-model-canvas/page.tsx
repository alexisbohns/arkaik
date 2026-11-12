import type { Metadata } from "next";
import { cache } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_SECTION_TITLE, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ExampleCard } from "@/components/arkademy/ExampleCard";
import { PromptBlock } from "@/components/arkademy/PromptBlock";
import { exampleCanvas, type ExampleCanvas } from "@/lib/arkademy/examples";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { BMC_FALLBACK_TITLE, bmcCoverMetadata } from "@/lib/arkademy/metadata";
import type { ArkademyDocument } from "@/lib/arkademy/schema";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { getArkademy } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy/business-model-canvas` — the cover: the tool's name and tagline,
 * the pitch, the gallery of examples (each with its paragraph and mini
 * canvas), and the baseline prompt to copy. Everything is server-rendered
 * from the library, so a crawler reads it all.
 *
 * The hero's two actions arrive with the pages they lead to: "Play a tour"
 * with part 3, "Start your own" with part 4.
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupArkademy();
  return bmcCoverMetadata(lookup.status === "ready" ? lookup.document.tools[0] : null);
}

export default async function BusinessModelCanvasCoverPage() {
  const lookup = await lookupArkademy();
  const tool = lookup.status === "ready" ? lookup.document.tools[0] : null;
  const title = tool?.title ?? BMC_FALLBACK_TITLE;
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      <ArkademyBreadcrumb trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: title }]} />
      <header className="mt-8 max-w-3xl sm:mt-10">
        <h1 className={ARKADEMY_TITLE}>{title}</h1>
        {tool && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{tool.tagline}</p>}
      </header>
      {lookup.status === "ready" ? (
        <CoverBody document={lookup.document} />
      ) : (
        <div className="mt-10">
          <ArkademyMessage status={lookup.status} />
        </div>
      )}
    </div>
  );
}

function CoverBody({ document }: { document: ArkademyDocument }) {
  const index = indexArkademy(document);
  const { tool } = index;
  const examples = tool.examples
    .map((id) => exampleCanvas(index, id))
    .filter((example): example is ExampleCanvas => example !== null);
  return (
    <>
      <section aria-labelledby="why" className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <h2 id="why" className={ARKADEMY_SECTION_TITLE}>
          {tool.pitch.headline}
        </h2>
        <div className="flex max-w-prose flex-col gap-4 text-[15px] leading-relaxed">
          {tool.pitch.body.map((paragraph, i) => (
            <p key={i} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section id="examples" aria-labelledby="examples-title" className="mt-20 scroll-mt-6">
        <h2 id="examples-title" className={ARKADEMY_SECTION_TITLE}>
          Examples
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Examples marked Simulation are built from public information, not from the companies&apos; own records.
        </p>
        <ul className="mt-8 flex flex-col gap-6">
          {examples.map((example) => (
            <li key={example.company.id}>
              <ExampleCard company={example.company} questions={tool.questions} state={example.questions} />
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-20 max-w-3xl">
        <PromptBlock label={tool.prompt.label} text={tool.prompt.text} />
      </div>
    </>
  );
}
