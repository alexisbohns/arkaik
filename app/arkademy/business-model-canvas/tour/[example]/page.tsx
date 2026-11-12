import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { CanvasWalk } from "@/components/arkademy/CanvasWalk";
import { StartYourOwnButton } from "@/components/arkademy/StartYourOwnButton";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
import { Badge } from "@/components/ui/badge";
import { exampleCanvas } from "@/lib/arkademy/examples";
import { ARKADEMY_HEAD_START_MS, settledWithin } from "@/lib/arkademy/head-start";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { BMC_FALLBACK_TITLE, bmcTourMetadata } from "@/lib/arkademy/metadata";
import { BMC_TOOL_ID, type ArkademyDocument } from "@/lib/arkademy/schema";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { parseStepParam, tourHref } from "@/lib/arkademy/tour";
import { getArkademy, type ArkademyLookup } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy/business-model-canvas/tour/{companyId}[?step=N]` — one example's
 * canvas built in nine steps (spec § "The tour"). The server renders step 1 at
 * its first phase (or step N complete); the client plays it. Never indexed
 * (bmcTourMetadata).
 *
 * Like the cover, the page gives the library a head start
 * (ARKADEMY_HEAD_START_MS). Answered in time — the usual case, the cover
 * having just warmed the cache — an id that is not one of the tool's examples
 * calls `notFound()` before anything is sent, so it is a real 404 inside the
 * Arkademy's chrome (app/arkademy/not-found.tsx), and a known one renders in
 * place. A slow read streams: the breadcrumb and a fallback h1 go at once,
 * the tour (or the message) replaces them when the read ends, and an unknown
 * id met only then calls `notFound()` inside the boundary, which Next turns
 * into the same not-found page with a `noindex` and a 200 status (the status
 * was sent before the read ended).
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

const COVER_PATH = ARKADEMY_TOOL_PATHS[BMC_TOOL_ID];

interface TourPageProps {
  params: Promise<{ example: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: TourPageProps): Promise<Metadata> {
  const { example } = await params;
  const lookup = await lookupArkademy();
  if (lookup.status !== "ready") return bmcTourMetadata(example, null);
  const index = indexArkademy(lookup.document);
  const found = exampleCanvas(index, example);
  return bmcTourMetadata(example, found ? { tool: index.tool, company: found.company } : null);
}

export default async function TourPage({ params, searchParams }: TourPageProps) {
  const [{ example }, query] = await Promise.all([params, searchParams]);
  const initialStep = parseStepParam(query.step);
  // A head start: a library that answers in time is rendered in place, with no
  // boundary, and an unknown example is a 404 before any byte is sent.
  const early = await settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS);
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-28 md:pb-24")}>
      {early ? (
        <TourFor lookup={early.value} example={example} initialStep={initialStep} />
      ) : (
        <Suspense fallback={<TourHead title={`${BMC_FALLBACK_TITLE} tour`} after={<LibraryPlaceholder className="mt-10" />} />}>
          <Tour example={example} initialStep={initialStep} />
        </Suspense>
      )}
    </div>
  );
}

/** The breadcrumb and the page's one h1, with whatever follows them. */
function TourHead({ title, after }: { title: string; after?: ReactNode }) {
  return (
    <>
      <ArkademyBreadcrumb
        trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: BMC_FALLBACK_TITLE, href: COVER_PATH }, { label: title }]}
      />
      <h1 className={cn(ARKADEMY_TITLE, "mt-6 wrap-anywhere")}>{title}</h1>
      {after}
    </>
  );
}

/** The part of the page that waits for the library, when it is slow. */
async function Tour({ example, initialStep }: { example: string; initialStep: number | null }) {
  return <TourFor lookup={await lookupArkademy()} example={example} initialStep={initialStep} />;
}

/** The tour for a lookup: the example's, a 404 for an unknown one, or the message for why there is no library. */
function TourFor({
  lookup,
  example,
  initialStep,
}: {
  lookup: ArkademyLookup;
  example: string;
  initialStep: number | null;
}) {
  if (lookup.status !== "ready") {
    return (
      <TourHead
        title={`${BMC_FALLBACK_TITLE} tour`}
        after={
          <div className="mt-10">
            <ArkademyMessage status={lookup.status} />
          </div>
        }
      />
    );
  }
  return <TourBody document={lookup.document} example={example} initialStep={initialStep} />;
}

function TourBody({
  document,
  example,
  initialStep,
}: {
  document: ArkademyDocument;
  example: string;
  initialStep: number | null;
}) {
  const index = indexArkademy(document);
  const canvas = exampleCanvas(index, example);
  if (!canvas) notFound();
  const { tool } = index;
  const { company } = canvas;

  // The end card's next example: the following one in gallery order, wrapping.
  const examples = tool.examples.filter((id) => index.company(id) !== undefined);
  const nextId = examples.length > 1 ? examples[(examples.indexOf(company.id) + 1) % examples.length] : null;
  const nextCompany = nextId ? index.company(nextId) : undefined;

  return (
    <>
      <ArkademyBreadcrumb
        trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: tool.title, href: COVER_PATH }, { label: company.name }]}
      />
      <header className="mt-6 mb-8 max-w-3xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={cn(ARKADEMY_TITLE, "min-w-0 wrap-anywhere")}>{company.name}</h1>
          {company.simulation && <Badge variant="outline">Simulation</Badge>}
        </div>
        <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{company.oneLiner}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          The {tool.title} in nine questions: watch each answer become a sentence and fill its block.
        </p>
      </header>
      <CanvasWalk
        key={company.id}
        mode="tour"
        company={company}
        questions={tool.questions}
        state={canvas.questions}
        initialStep={initialStep}
        next={nextCompany ? { name: nextCompany.name, href: tourHref(nextCompany.id) } : null}
        examplesHref={`${COVER_PATH}#examples`}
        endActions={<StartYourOwnButton />}
      />
      {company.note && <p className="mt-8 max-w-prose text-xs leading-relaxed text-muted-foreground">{company.note}</p>}
    </>
  );
}
