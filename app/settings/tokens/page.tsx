import type { Metadata } from "next";

import { TokenManager } from "@/components/settings/TokenManager";

/**
 * /settings/tokens — agent-token management (db/migrations/007_api_tokens.sql).
 *
 * A thin server shell around a client component: everything here depends on the
 * session, and `TokenManager` already hides itself when auth is unconfigured, so
 * this page stays harmless on a local-first deployment with no database.
 */
export const metadata: Metadata = {
  title: "Agent tokens · arkaik",
  description: "Create and revoke tokens so the arkaik CLI and coding agents can reach your projects.",
};

export default function TokensSettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agent tokens</h1>
        <p className="text-sm text-muted-foreground">
          Tokens let the <code className="font-mono text-xs">arkaik</code> CLI and MCP server act as you
          from a terminal or CI. They are shown once, stored hashed, and can be revoked at any time.
        </p>
      </header>
      <TokenManager />
    </main>
  );
}
