import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";

import { ArkademyBreadcrumb } from "@/components/arkademy/ArkademyBreadcrumb";
import { ARKADEMY_COLUMN } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { exampleAccent } from "@/components/arkademy/example-accents";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
import { M3_DEFAULT_FONT, isM3Font } from "@/components/arkademy/m3-font-options";
import { M3_FONT_CSS } from "@/components/arkademy/m3-fonts";
import { M3_DEFAULT_SCHEME, isM3Scheme, showsM3Preview } from "@/components/arkademy/m3-schemes";
import { SchemePicker } from "@/components/arkademy/SchemePicker";
import { TourStage } from "@/components/arkademy/TourStage";
import { TourThemeToggle } from "@/components/arkademy/TourThemeToggle";
import { exampleCanvas, type ExampleCanvas } from "@/lib/arkademy/examples";
import { ARKADEMY_HEAD_START_MS, settledWithin } from "@/lib/arkademy/head-start";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { BMC_FALLBACK_TITLE, bmcTourMetadata } from "@/lib/arkademy/metadata";
import { BMC_TOOL_ID, type ArkademyDocument } from "@/lib/arkademy/schema";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { getArkademy, type ArkademyLookup } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

import "../../m3-expressive.css";
import "../m3-tour.css";

/**
 * `/arkademy/business-model-canvas/tour/{companyId}[?step=N[&beat=canvas] | ?step=end]`
 * — one example's canvas, one screen at a time (spec § "The tour";
 * lib/arkademy/tour-stage.ts): the opening, each question asked and then
 * turned face up on the deck, the end. The reader moves it; the address names
 * the screen, and the server renders that screen whole (TourStage reads the
 * same address), so a reload, a shared link and a reader without JavaScript
 * all land on it. Never indexed (bmcTourMetadata).
 *
 * Drawn as the cover is, in Material 3 Expressive: the `[data-m3="expressive"]`
 * wrapper turns on the cover's stylesheet (scheme, type, shapes, springs) and
 * `[data-m3-tour]` the tour's own (../m3-tour.css). PREVIEW ONLY, as on the
 * cover: `?scheme=` and `?font=` pick a scheme and a brand face, and the
 * SchemePicker (only on a review link, `?preview`) sets both live; every
 * move through the tour keeps them.
 *
 * Like the cover, the page gives the library a head start
 * (ARKADEMY_HEAD_START_MS). Answered in time — the usual case, the cover
 * having just warmed the cache — an id that is not one of the tool's examples
 * calls `notFound()` before anything is sent, so it is a real 404 inside the
 * Arkademy's chrome (app/arkademy/not-found.tsx), and a known one renders in
 * place. A slow read streams: a fallback h1 goes at once, the tour (or the
 * message) replaces it when the read ends, and an unknown id met only then
 * calls `notFound()` inside the boundary, which Next turns into the same
 * not-found page with a `noindex` and a 200 status (the status was sent
 * before the read ended).
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
  const scheme = isM3Scheme(query.scheme) ? query.scheme : M3_DEFAULT_SCHEME;
  const font = isM3Font(query.font) ? query.font : M3_DEFAULT_FONT;
  // A head start: a library that answers in time is rendered in place, with no
  // boundary, and an unknown example is a 404 before any byte is sent.
  const early = await settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS);
  return (
    <div
      data-m3="expressive"
      data-m3-tour=""
      data-scheme={scheme === M3_DEFAULT_SCHEME ? undefined : scheme}
      data-font={font === M3_DEFAULT_FONT ? undefined : font}
    >
      <style href="arkademy-m3x-fun-font" precedence="default">
        {M3_FONT_CSS}
      </style>
      {early ? (
        <TourFor lookup={early.value} example={example} search={searchOf(query)} />
      ) : (
        <Suspense fallback={<TourHead title={`${BMC_FALLBACK_TITLE} tour`} after={<LibraryPlaceholder className="mt-10" />} />}>
          <Tour example={example} search={searchOf(query)} />
        </Suspense>
      )}
      {showsM3Preview(query) && <SchemePicker initial={scheme} initialFont={font} />}
    </div>
  );
}

/** Without a tour to show: the breadcrumb and the page's one h1, with whatever follows them. */
function TourHead({ title, after }: { title: string; after?: ReactNode }) {
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-6 pb-24")}>
      {/* The tour's route draws no Arkademy header (ArkademyHeaderSlot), so the theme rides with the breadcrumb. */}
      <div className="flex items-center justify-between gap-4">
        <ArkademyBreadcrumb
          trail={[{ label: "Arkademy", href: ARKADEMY_PATH }, { label: BMC_FALLBACK_TITLE, href: COVER_PATH }, { label: title }]}
        />
        <TourThemeToggle />
      </div>
      <h1 className="mx-display mt-8 wrap-anywhere text-(--md-on-surface)">{title}</h1>
      {after}
    </div>
  );
}

/** The query string the page was asked with, as `location.search` holds it (without the `?`). */
function searchOf(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, one);
  }
  return params.toString();
}

/** The part of the page that waits for the library, when it is slow. */
async function Tour({ example, search }: { example: string; search: string }) {
  return <TourFor lookup={await lookupArkademy()} example={example} search={search} />;
}

/** The tour for a lookup: the example's, a 404 for an unknown one, or the message for why there is no library. */
function TourFor({ lookup, example, search }: { lookup: ArkademyLookup; example: string; search: string }) {
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
  return <TourBody document={lookup.document} example={example} search={search} />;
}

function TourBody({ document, example, search }: { document: ArkademyDocument; example: string; search: string }) {
  const index = indexArkademy(document);
  const canvas = exampleCanvas(index, example);
  if (!canvas) notFound();
  const { tool } = index;
  // The company's badge is its cover card's: the same accent, by its place in the gallery.
  const gallery = tool.examples
    .map((id) => exampleCanvas(index, id))
    .filter((entry): entry is ExampleCanvas => entry !== null);
  const position = gallery.findIndex((entry) => entry.company.id === canvas.company.id);
  return (
    <TourStage
      key={canvas.company.id}
      company={canvas.company}
      questions={tool.questions}
      state={canvas.questions}
      accent={exampleAccent(position)}
      toolTitle={tool.title}
      coverHref={COVER_PATH}
      search={search}
    />
  );
}
