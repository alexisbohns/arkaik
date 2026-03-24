import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const REPO_ROOT = process.cwd();
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const SCHEMA_DIR = path.join(REPO_ROOT, "public", "schema");

const DOC_FILES = [
  "architecture.md",
  "graph-model.md",
  "data-layer.md",
  "conventions.md",
  "vision.md",
];

export async function GET() {
  const sections: string[] = [];

  sections.push("# Arkaik — Full Documentation for LLMs\n");
  sections.push("> Product graph browser for product architects\n");
  sections.push(
    "This file contains the complete Arkaik documentation, the ProjectBundle JSON Schema, " +
    "and an example bundle. It is designed to be consumed by LLMs to understand the Arkaik " +
    "data model and generate valid project bundles.\n",
  );

  // Documentation
  sections.push("---\n\n# Documentation\n");
  for (const file of DOC_FILES) {
    try {
      const content = await fs.readFile(path.join(DOCS_DIR, file), "utf-8");
      sections.push(`## ${file.replace(".md", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n`);
      sections.push(content.trim());
      sections.push("");
    } catch {
      // Skip missing files
    }
  }

  // JSON Schema
  sections.push("---\n\n# ProjectBundle JSON Schema\n");
  sections.push(
    "The following JSON Schema defines the structure of an Arkaik ProjectBundle, " +
    "the import/export format for Arkaik projects.\n",
  );
  try {
    const schema = await fs.readFile(path.join(SCHEMA_DIR, "project-bundle.json"), "utf-8");
    sections.push("```json");
    sections.push(schema.trim());
    sections.push("```\n");
  } catch {
    sections.push("(Schema file not found)\n");
  }

  // Example bundle
  sections.push("---\n\n# Example ProjectBundle\n");
  sections.push(
    "A complete example showing all four species (flow, view, data-model, api-endpoint), " +
    "all edge types (composes, calls, displays, queries), and playlist entries with conditions.\n",
  );
  try {
    const example = await fs.readFile(path.join(SCHEMA_DIR, "example-bundle.json"), "utf-8");
    sections.push("```json");
    sections.push(example.trim());
    sections.push("```\n");
  } catch {
    sections.push("(Example file not found)\n");
  }

  const body = sections.join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
