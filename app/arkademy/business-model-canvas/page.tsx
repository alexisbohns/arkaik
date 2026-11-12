import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_SECTION_TITLE, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ExampleCard } from "@/components/arkademy/ExampleCard";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
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
 * Everything but the chrome reads the library, so the page body sits behind
 * one Suspense boundary whose fallback is the page as it is known without the
 * library: the breadcrumb and the h1 with the tool's fallback title, then a
 * quiet placeholder. The chrome and that fallback are sent at once; the cover
 * (or the message) replaces them when the read ends, within
 * ARKADEMY_READ_TIMEOUT_MS whatever the database does. There is one h1 in
 * every state.
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

export default function BusinessModelCanvasCoverPage() {
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      <Suspense fallback={<CoverHead title={BMC_FALLBACK_TITLE} after={<LibraryPlaceholder className="mt-10" />} />}>
        <Cover />
      </Suspense>
    </div>
  );
}

/** The breadcrumb and the hero: the same markup with or without the library. */
function CoverHead({ title, tagline, after }: { title: string; tagline?: string; after?: ReactNode }) {
  return (
    <>
      <ArkademyBreadcrumb trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: title }]} />
      <header className="mt-8 max-w-3xl sm:mt-10">
        <h1 className={ARKADEMY_TITLE}>{title}</h1>
        {tagline && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{tagline}</p>}
      </header>
      {after}
    </>
  );
}

/** The part of the cover that waits for the library. */
async function Cover() {
  const lookup = await lookupArkademy();
  if (lookup.status !== "ready") {
    return (
      <CoverHead
        title={BMC_FALLBACK_TITLE}
        after={
          <div className="mt-10">
            <ArkademyMessage status={lookup.status} />
          </div>
        }
      />
    );
  }
  const tool = lookup.document.tools[0];
  return <CoverHead title={tool.title} tagline={tool.tagline} after={<CoverBody document={lookup.document} />} />;
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
