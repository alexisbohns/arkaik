import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import matter from "gray-matter";

const REPO_ROOT = process.cwd();
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const ROOT_README_PATH = path.join(REPO_ROOT, "README.md");

interface DocFrontmatter {
  title?: string;
  navTitle?: string;
  order?: number;
  hidden?: boolean;
}

export interface DocEntry {
  slugParts: string[];
  slug: string;
  href: string;
  title: string;
  navTitle: string;
  order: number;
  sourcePath: string;
  filePath: string;
}

export interface DocDocument extends DocEntry {
  content: string;
}

export interface DocsNavItem {
  title: string;
  href?: string;
  children?: DocsNavItem[];
}

interface DocsIndex {
  entries: DocEntry[];
  entriesBySlug: Map<string, DocEntry>;
  home: DocDocument;
}

interface NavNode {
  title: string;
  href?: string;
  order: number;
  children: Map<string, NavNode>;
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function slugKey(slugParts: string[]) {
  return slugParts.map((part) => part.trim().toLowerCase()).filter(Boolean).join("/");
}

function toHref(slugParts: string[]) {
  return slugParts.length === 0 ? "/docs" : `/docs/${slugParts.join("/")}`;
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function extractHeading(content: string) {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() ?? null;
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const nextPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return walkMarkdownFiles(nextPath);
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
          return [] as string[];
        }

        return [nextPath];
      }),
  );

  return files.flat();
}

function createEntryFromFile(
  filePath: string,
  sourcePath: string,
  markdown: string,
): DocEntry | null {
  const { data, content } = matter(markdown);
  const frontmatter = data as DocFrontmatter;
  if (frontmatter.hidden) {
    return null;
  }

  const sourceParts = sourcePath.split("/");
  const filename = sourceParts[sourceParts.length - 1] ?? "";
  const stem = filename.replace(/\.md$/i, "");
  const stemLower = stem.toLowerCase();

  const directoryParts = sourceParts.slice(0, -1);
  const slugParts = [...directoryParts];

  // Treat index/readme files as directory docs; leaf docs keep the filename slug.
  if (stemLower !== "index" && stemLower !== "readme") {
    slugParts.push(stem);
  }

  if (slugParts.length === 0) {
    return null;
  }

  const fallbackTitleSource = stemLower === "index" || stemLower === "readme"
    ? directoryParts[directoryParts.length - 1] ?? "Document"
    : stem;
  const headingTitle = extractHeading(content);
  const explicitTitle = frontmatter.title?.trim();
  const title = explicitTitle || headingTitle || titleCase(fallbackTitleSource);

  return {
    slugParts,
    slug: slugParts.join("/"),
    href: toHref(slugParts),
    title,
    navTitle: frontmatter.navTitle?.trim() || title,
    order: Number.isFinite(frontmatter.order) ? Number(frontmatter.order) : 0,
    sourcePath: `docs/${sourcePath}`,
    filePath,
  };
}

async function readMarkdownDocument(
  filePath: string,
  sourcePath: string,
  slugParts: string[],
  fallbackTitle: string,
): Promise<DocDocument> {
  const markdown = await fs.readFile(filePath, "utf8");
  const { data, content } = matter(markdown);
  const frontmatter = data as DocFrontmatter;
  const headingTitle = extractHeading(content);
  const explicitTitle = frontmatter.title?.trim();
  const title = explicitTitle || headingTitle || fallbackTitle;

  return {
    slugParts,
    slug: slugParts.join("/"),
    href: toHref(slugParts),
    title,
    navTitle: frontmatter.navTitle?.trim() || title,
    order: Number.isFinite(frontmatter.order) ? Number(frontmatter.order) : 0,
    sourcePath,
    filePath,
    content,
  };
}

const getDocsIndex = cache(async (): Promise<DocsIndex> => {
  const [rootReadme, markdownFiles] = await Promise.all([
    readMarkdownDocument(ROOT_README_PATH, "README.md", [], "Documentation"),
    walkMarkdownFiles(DOCS_DIR),
  ]);

  const entries = (
    await Promise.all(
      markdownFiles.map(async (filePath) => {
        const relativePath = toPosixPath(path.relative(DOCS_DIR, filePath));
        if (relativePath.toLowerCase() === "readme.md") {
          return null;
        }

        const markdown = await fs.readFile(filePath, "utf8");
        return createEntryFromFile(filePath, relativePath, markdown);
      }),
    )
  )
    .filter((entry): entry is DocEntry => Boolean(entry))
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.navTitle.localeCompare(b.navTitle);
    });

  const entriesBySlug = new Map(entries.map((entry) => [slugKey(entry.slugParts), entry]));

  return {
    entries,
    entriesBySlug,
    home: rootReadme,
  };
});

function addEntryToTree(root: Map<string, NavNode>, entry: DocEntry) {
  let current = root;

  for (let i = 0; i < entry.slugParts.length; i += 1) {
    const slugPart = entry.slugParts[i] ?? "";
    const isLeaf = i === entry.slugParts.length - 1;
    const existing = current.get(slugPart);
    const defaultTitle = titleCase(slugPart);

    const node: NavNode = existing ?? {
      title: defaultTitle,
      order: Number.MAX_SAFE_INTEGER,
      children: new Map<string, NavNode>(),
    };

    if (isLeaf) {
      node.title = entry.navTitle;
      node.href = entry.href;
      node.order = entry.order;
    }

    current.set(slugPart, node);
    current = node.children;
  }
}

function sortNavNodes(nodes: Iterable<NavNode>): DocsNavItem[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.title.localeCompare(b.title);
    })
    .map((node) => {
      const children = sortNavNodes(node.children.values());
      return {
        title: node.title,
        href: node.href,
        children: children.length > 0 ? children : undefined,
      };
    });
}

export const getDocsNavigation = cache(async (): Promise<DocsNavItem[]> => {
  const { entries } = await getDocsIndex();
  const root = new Map<string, NavNode>();

  for (const entry of entries) {
    addEntryToTree(root, entry);
  }

  return [
    { title: "Overview", href: "/docs" },
    ...sortNavNodes(root.values()),
  ];
});

export async function getDocBySlugParts(slugParts: string[]): Promise<DocDocument | null> {
  const { home, entriesBySlug } = await getDocsIndex();
  const normalized = slugParts.map((part) => part.trim()).filter(Boolean);

  if (normalized.length === 0) {
    return home;
  }

  const entry = entriesBySlug.get(slugKey(normalized));
  if (!entry) {
    return null;
  }

  const markdown = await fs.readFile(entry.filePath, "utf8");
  const { data, content } = matter(markdown);
  const frontmatter = data as DocFrontmatter;

  return {
    ...entry,
    title: frontmatter.title?.trim() || entry.title,
    navTitle: frontmatter.navTitle?.trim() || entry.navTitle,
    content,
  };
}

export async function getAllDocEntries(): Promise<DocEntry[]> {
  const { entries } = await getDocsIndex();
  return entries;
}
