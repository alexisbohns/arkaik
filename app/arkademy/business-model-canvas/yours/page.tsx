import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
import { StrandedDraft } from "@/components/arkademy/StrandedDraft";
import { YourCanvas } from "@/components/arkademy/YourCanvas";
import { ARKADEMY_HEAD_START_MS, settledWithin } from "@/lib/arkademy/head-start";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { inspirationCatalog } from "@/lib/arkademy/inspirations";
import { BMC_FALLBACK_TITLE, bmcYoursMetadata } from "@/lib/arkademy/metadata";
import { BMC_TOOL_ID } from "@/lib/arkademy/schema";
import { parseStepParam } from "@/lib/arkademy/tour";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { getArkademy, type ArkademyLookup } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy/business-model-canvas/yours[?step=1..9]` — your own canvas: the
 * nine questions answered for the visitor's own product, with inspirations
 * from the library. The draft lives in this browser only, so the server sends
 * the questions and the inspirations and the client draws the rest. Never
 * indexed (bmcYoursMetadata).
 *
 * Like the cover, the page gives the library a head start
 * (ARKADEMY_HEAD_START_MS) and renders in place when it answers in time;
 * otherwise the breadcrumb, the h1 and the intro go out at once and the
 * editor (or the message) streams in behind Suspense. One h1 in every state.
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupArkademy();
  return bmcYoursMetadata(lookup.status === "ready" ? lookup.document.tools[0] : null);
}

export default async function YourCanvasPage({ searchParams }: { searchParams: Promise<{ step?: string | string[] }> }) {
  const [{ step }, early] = await Promise.all([
    searchParams,
    settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS),
  ]);
  const initialStep = parseStepParam(step);
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      {early ? (
        <YoursFor lookup={early.value} initialStep={initialStep} />
      ) : (
        <Suspense fallback={<YoursHead toolTitle={BMC_FALLBACK_TITLE} after={<LibraryPlaceholder />} />}>
          <Yours initialStep={initialStep} />
        </Suspense>
      )}
    </div>
  );
}

/** The breadcrumb, the h1 and the intro: the same with or without the library. */
function YoursHead({ toolTitle, after }: { toolTitle: string; after: ReactNode }) {
  const coverPath = ARKADEMY_TOOL_PATHS[BMC_TOOL_ID];
  return (
    <>
      <ArkademyBreadcrumb
        trail={[
          { label: "Arkademy", href: ARKADEMY_PATH },
          { label: toolTitle, href: coverPath },
          { label: "Your canvas" },
        ]}
      />
      <header className="mt-8 max-w-3xl sm:mt-10">
        <h1 className={ARKADEMY_TITLE}>Your canvas</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Answer the nine questions for your own product, one at a time. Each answer becomes a sentence of your
          paragraph and a line of your canvas. Everything stays in this browser.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Not sure how an answer reads?{" "}
          <Link href={`${coverPath}#examples`} className="text-foreground underline underline-offset-4">
            Read an example first
          </Link>
          .
        </p>
      </header>
      <div className="mt-10">{after}</div>
    </>
  );
}

/** The part of the page that waits for the library, when it is slow. */
async function Yours({ initialStep }: { initialStep: number | null }) {
  return <YoursFor lookup={await lookupArkademy()} initialStep={initialStep} />;
}

/** The editor for a ready library; otherwise the message, and the saved draft to download. */
function YoursFor({ lookup, initialStep }: { lookup: ArkademyLookup; initialStep: number | null }) {
  if (lookup.status !== "ready") {
    return (
      <YoursHead
        toolTitle={BMC_FALLBACK_TITLE}
        after={
          <>
            <ArkademyMessage status={lookup.status} />
            <StrandedDraft />
          </>
        }
      />
    );
  }
  const tool = lookup.document.tools[0];
  return (
    <YoursHead
      toolTitle={tool.title}
      after={
        <YourCanvas
          tool={{ title: tool.title, questions: tool.questions, examples: tool.examples }}
          catalog={inspirationCatalog(indexArkademy(lookup.document))}
          documentVersion={lookup.version}
          initialStep={initialStep}
        />
      }
    />
  );
}
