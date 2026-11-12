import type { Metadata } from "next";

import { BMC_TOOL_ID } from "./constants";
import type { BmcTool, Company } from "./schema";
import { ARKADEMY_PATH, ARKADEMY_TOOL_PATHS, BMC_YOURS_PATH, bmcTourPath } from "./tools";

/**
 * Each Arkademy page's metadata, pure so it is tested (spec § "Metadata,
 * robots and sitemap"). Every page sets its own canonical URL and Open Graph
 * URL: the root layout's point at the home page, and a page inheriting them
 * tells search engines it is a duplicate of `/`. Next replaces a top-level
 * key (`robots`, `openGraph`) whole, so nothing of the root's leaks through.
 */

export const ARKADEMY_SITE_URL = "https://arkaik.app";

/** The shell's line of UI copy, and its meta description. */
export const ARKADEMY_INTRO =
  "Thinking tools for product builders, learned by watching each one applied to real products, then used on your own.";

/** The Business Model Canvas's name when no document can be read. */
export const BMC_FALLBACK_TITLE = "Business Model Canvas";
const BMC_FALLBACK_DESCRIPTION =
  "The Business Model Canvas as nine plain questions, answered by example, then by you.";
const BMC_YOURS_DESCRIPTION =
  "Answer the Business Model Canvas's nine questions for your own product. Your canvas stays in this browser.";

const NOINDEX = { index: false, follow: false };

function arkademyPageMetadata(page: {
  title: string;
  socialTitle: string;
  description: string;
  path: string;
  indexed: boolean;
}): Metadata {
  const url = `${ARKADEMY_SITE_URL}${page.path}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.socialTitle,
      description: page.description,
      url,
      siteName: "arkaik",
      type: "website",
      locale: "en_US",
    },
    twitter: { card: "summary", title: page.socialTitle, description: page.description },
    ...(page.indexed ? {} : { robots: NOINDEX }),
  };
}

/**
 * `/arkademy`: fixed copy, indexable when the library is ready. Without it
 * (`libraryReady` false or omitted) the page shows a message instead of its
 * cards, and an outage must not be indexed as the page: `noindex`.
 */
export function arkademyShellMetadata(libraryReady?: boolean): Metadata {
  return arkademyPageMetadata({
    title: "Arkademy | arkaik",
    socialTitle: "Arkademy",
    description: ARKADEMY_INTRO,
    path: ARKADEMY_PATH,
    indexed: libraryReady === true,
  });
}

/**
 * `/arkademy/business-model-canvas`: indexable with the library's tool; with
 * `null` (no library: empty, invalid, unreachable, unconfigured), fixed copy
 * and `noindex`, so a crawl during an outage never indexes the error message.
 */
export function bmcCoverMetadata(tool: BmcTool | null): Metadata {
  const title = tool?.title ?? BMC_FALLBACK_TITLE;
  return arkademyPageMetadata({
    title: `${title} | arkaik Arkademy`,
    socialTitle: title,
    description: tool?.tagline ?? BMC_FALLBACK_DESCRIPTION,
    path: ARKADEMY_TOOL_PATHS[BMC_TOOL_ID],
    indexed: tool !== null,
  });
}

/**
 * A tour (part 3): never indexed; the canonical URL drops `?step=`.
 * `found` is null when there is no document or no such example.
 */
export function bmcTourMetadata(companyId: string, found: { tool: BmcTool; company: Company } | null): Metadata {
  const toolTitle = found?.tool.title ?? BMC_FALLBACK_TITLE;
  const socialTitle = found ? `${found.company.name}: ${toolTitle} tour` : `${toolTitle} tour`;
  return arkademyPageMetadata({
    title: `${socialTitle} | arkaik Arkademy`,
    socialTitle,
    description: found?.company.oneLiner ?? BMC_FALLBACK_DESCRIPTION,
    path: bmcTourPath(companyId),
    indexed: false,
  });
}

/** Your own canvas (part 4): never indexed — its server HTML holds nothing but the questions. */
export function bmcYoursMetadata(tool: BmcTool | null): Metadata {
  const socialTitle = `Your ${tool?.title ?? BMC_FALLBACK_TITLE}`;
  return arkademyPageMetadata({
    title: `${socialTitle} | arkaik Arkademy`,
    socialTitle,
    description: BMC_YOURS_DESCRIPTION,
    path: BMC_YOURS_PATH,
    indexed: false,
  });
}
