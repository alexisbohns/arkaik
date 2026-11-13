import type { Metadata } from "next";
import Link from "next/link";
import { CirclePlayIcon, PencilLineIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";

import { ARKADEMY_COLUMN } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ExampleCard } from "@/components/arkademy/ExampleCard";
import { ExampleGallery } from "@/components/arkademy/ExampleGallery";
import { exampleAccent } from "@/components/arkademy/example-accents";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { HeroBarWatch } from "@/components/arkademy/HeroBarWatch";
import { LibraryPlaceholder } from "@/components/arkademy/LibraryPlaceholder";
import { M3_DEFAULT_SCHEME, isM3Scheme, showsM3Preview } from "@/components/arkademy/m3-schemes";
import { PromptBlock } from "@/components/arkademy/PromptBlock";
import { M3_DEFAULT_FONT, isM3Font } from "@/components/arkademy/m3-font-options";
import { M3_FONT_CSS } from "@/components/arkademy/m3-fonts";
import { SchemePicker } from "@/components/arkademy/SchemePicker";
import { StartYourOwnLink } from "@/components/arkademy/StartYourOwnLink";
import { exampleCanvas, type ExampleCanvas } from "@/lib/arkademy/examples";
import {
  ARKADEMY_HEAD_START_MS,
  settledWithin,
} from "@/lib/arkademy/head-start";
import { indexArkademy } from "@/lib/arkademy/index-document";
import { BMC_FALLBACK_TITLE, bmcCoverMetadata } from "@/lib/arkademy/metadata";
import type { ArkademyDocument } from "@/lib/arkademy/schema";
import { tourHref } from "@/lib/arkademy/tour";
import { getArkademy, type ArkademyLookup } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

import "./m3-expressive.css";

/**
 * `/arkademy/business-model-canvas` — the cover: the tool's name and tagline,
 * the pitch, the gallery of examples (a horizontal strip of cards, each with
 * its paragraph and mini canvas), and the baseline prompt to copy. Everything is server-rendered
 * from the library, so a crawler reads it all.
 *
 * Everything but the chrome reads the library, so the page body sits behind
 * one Suspense boundary whose fallback is the page as it is known without the
 * library: the hero with the tool's fallback title, then a
 * quiet placeholder. The page first gives the library a head start
 * (ARKADEMY_HEAD_START_MS): answered in time, the cover is rendered in place
 * with no boundary, whole in the HTML. Otherwise the chrome and that fallback
 * are sent at once, and the cover (or the message) replaces them when the
 * read ends, within ARKADEMY_READ_TIMEOUT_MS whatever the database does.
 * There is one h1 in every state.
 *
 * The hero's "Play a tour" leads to the gallery, where each example plays its
 * own tour; "Start your own" arrives with part 4.
 *
 * Drawn as Material 3 Expressive: the `[data-m3="expressive"]` wrapper turns
 * on ./m3-expressive.css — a vibrant scheme from the stones' ember, the type
 * scale in two faces (DynaPuff, rounded and playful, for display, headline
 * and title; Inclusive Sans for body, label and subtitles), the expanded
 * shape scale with shapes as accents, spring motion, a connected button group
 * and the examples as a carousel whose items morph in and out of focus. The
 * hero runs up under the app bar (no breadcrumb on the cover). PREVIEW ONLY:
 * `?scheme=` picks one of the preview schemes and `?font=` one of the brand
 * faces (components/arkademy/m3-fonts.ts); SchemePicker, a review tool
 * shown only on a review link (`?preview`, or one naming a scheme or face),
 * sets both live. The faces themselves come from m3-fonts.ts.
 */
export const dynamic = "force-dynamic";

/** One library read per request: generateMetadata and the page share it. */
const lookupArkademy = cache(getArkademy);

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupArkademy();
  return bmcCoverMetadata(
    lookup.status === "ready" ? lookup.document.tools[0] : null,
  );
}

export default async function BusinessModelCanvasCoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const scheme = isM3Scheme(params.scheme) ? params.scheme : M3_DEFAULT_SCHEME;
  const font = isM3Font(params.font) ? params.font : M3_DEFAULT_FONT;
  // A head start: a library that answers in time is rendered in place, with no
  // boundary, so a reader or crawler without JavaScript gets the whole cover.
  const early = await settledWithin(lookupArkademy(), ARKADEMY_HEAD_START_MS);
  return (
    <div
      data-m3="expressive"
      data-scheme={scheme === M3_DEFAULT_SCHEME ? undefined : scheme}
      data-font={font === M3_DEFAULT_FONT ? undefined : font}
      className="pb-24"
    >
      <style href="arkademy-m3x-fun-font" precedence="default">
        {M3_FONT_CSS}
      </style>
      {early ? (
        <CoverFor lookup={early.value} />
      ) : (
        <Suspense
          fallback={
            <CoverHead
              title={BMC_FALLBACK_TITLE}
              after={
                <div className={ARKADEMY_COLUMN}>
                  <LibraryPlaceholder className="mt-10" />
                </div>
              }
            />
          }
        >
          <Cover />
        </Suspense>
      )}
      {showsM3Preview(params) && <SchemePicker initial={scheme} initialFont={font} />}
    </div>
  );
}

/**
 * The hero's accent: a nine-sided cookie (the nine questions) carrying a 9,
 * with a clover and a soft burst beside it. They spring in once on load
 * (not with reduced motion). Decorative, so hidden from assistive tech.
 */
function HeroShapes() {
  return (
    <div aria-hidden="true" className="relative mx-auto hidden aspect-square w-full max-w-[24rem] lg:block">
      <div className="mx-hero-shape absolute inset-[6%] text-(--md-primary)">
        <ExpressiveShape shape="cookie9" className="size-full" />
        <span className="mx-hero-title mx-numeral absolute inset-0 grid place-items-center text-[10rem] text-(--md-on-primary)">
          9
        </span>
      </div>
      <ExpressiveShape
        shape="clover4"
        className="mx-hero-shape mx-hero-shape--late absolute -top-3 -right-2 size-28 text-(--md-tertiary)"
      />
      <ExpressiveShape
        shape="sunny"
        className="mx-hero-shape mx-hero-shape--later absolute bottom-2 -left-1 size-24 text-(--mx-hero-burst)"
      />
    </div>
  );
}

/**
 * The hero: the same markup with or without the library. It runs edge to edge
 * and up under the sticky app bar (the stylesheet pulls it up by the bar's
 * height), its content in the page column; HeroBarWatch, at its foot, tells
 * the bar when it has scrolled away. `after` lays out its own column, so the
 * examples' carousel can run to the window's edges.
 */
function CoverHead({
  title,
  tagline,
  actions,
  after,
}: {
  title: string;
  tagline?: string;
  actions?: ReactNode;
  after?: ReactNode;
}) {
  return (
    <>
      <header className="mx-hero relative">
        <div
          className={cn(
            ARKADEMY_COLUMN,
            "grid items-center gap-10 pt-6 pb-12 sm:pt-12 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-12 lg:pt-14 lg:pb-24",
          )}
        >
          <div className="min-w-0">
            <div aria-hidden="true" className="relative mb-6 size-20 text-(--md-primary) lg:hidden">
              <ExpressiveShape shape="cookie9" className="mx-hero-shape size-full" />
              <span className="mx-headline-l mx-numeral absolute inset-0 grid place-items-center text-(--md-on-primary)">9</span>
            </div>
            <h1 className="mx-hero-title wrap-anywhere">{title}</h1>
            {tagline && (
              <p className="mx-subtitle mt-6 max-w-xl sm:mt-8">{tagline}</p>
            )}
            {actions && (
              <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">{actions}</div>
            )}
          </div>
          <HeroShapes />
        </div>
        <HeroBarWatch />
      </header>
      {after}
    </>
  );
}

/** The part of the cover that waits for the library, when it is slow. */
async function Cover() {
  return <CoverFor lookup={await lookupArkademy()} />;
}

/** The cover for a lookup: the library's, or the message for why there is none. */
function CoverFor({ lookup }: { lookup: ArkademyLookup }) {
  if (lookup.status !== "ready") {
    return (
      <CoverHead
        title={BMC_FALLBACK_TITLE}
        after={
          <div className={cn(ARKADEMY_COLUMN, "mt-10")}>
            <ArkademyMessage status={lookup.status} />
          </div>
        }
      />
    );
  }
  const tool = lookup.document.tools[0];
  return (
    <CoverHead
      title={tool.title}
      tagline={tool.tagline}
      actions={
        <>
          <StartYourOwnLink
            className="mx-btn mx-btn--l mx-btn--filled"
            icon={<PencilLineIcon aria-hidden="true" />}
          />
          <a href="#examples" className="mx-btn mx-btn--m mx-btn--elevated">
            <CirclePlayIcon aria-hidden="true" />
            Play a tour
          </a>
        </>
      }
      after={<CoverBody document={lookup.document} />}
    />
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
      <section
        aria-labelledby="why"
        className={cn(
          ARKADEMY_COLUMN,
          "mt-20 grid gap-8 sm:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-16",
        )}
      >
        <div>
          <ExpressiveShape shape="clover4" className="size-14 text-(--md-tertiary-fixed-dim)" />
          <h2 id="why" className="mx-headline-l mt-6 text-balance text-(--md-primary)">
            {tool.pitch.headline}
          </h2>
        </div>
        <div className="flex max-w-prose flex-col gap-5">
          {tool.pitch.body.map((paragraph, i) => (
            <p
              key={i}
              className={cn(
                "whitespace-pre-line",
                i === 0
                  ? "mx-lede text-(--md-on-surface)"
                  : "mx-body-l text-(--md-on-surface-variant)",
              )}
            >
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section
        id="examples"
        aria-labelledby="examples-title"
        className="mt-20 sm:mt-28"
      >
        <ExampleGallery
          label="Examples"
          header={
            <>
              <h2 id="examples-title" className="mx-display text-(--md-on-surface)">
                Examples
              </h2>
              <p className="mx-body-m mt-3 max-w-prose text-(--md-on-surface-variant)">
                Examples marked Simulation are built from public information,
                not from the companies&apos; own records.
              </p>
            </>
          }
        >
          {examples.map((example, i) => (
            <li key={example.company.id}>
              <ExampleCard
                className="w-full"
                accent={exampleAccent(i)}
                company={example.company}
                questions={tool.questions}
                state={example.questions}
                actions={
                  <Link
                    href={tourHref(example.company.id)}
                    className="mx-btn mx-btn--tonal"
                  >
                    <CirclePlayIcon aria-hidden="true" />
                    Play the tour
                    <span className="sr-only">: {example.company.name}</span>
                  </Link>
                }
              />
            </li>
          ))}
        </ExampleGallery>
      </section>

      <div className={ARKADEMY_COLUMN}>
        <div className="mt-20 sm:mt-28">
          <PromptBlock label={tool.prompt.label} text={tool.prompt.text} />
        </div>
      </div>
    </>
  );
}
