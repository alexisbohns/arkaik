"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";

/**
 * Agent-token management (db/migrations/007_api_tokens.sql).
 *
 * The one-time-secret rule is a UI responsibility as much as a server one: the
 * plaintext arrives in the mint response and exists nowhere else, ever. It is
 * rendered in a dismissable panel that says so plainly, because a user who
 * assumes they can come back for it later has effectively lost the token.
 *
 * GRACEFUL ABSENCE, matching components/auth/AuthButton.tsx: this renders
 * nothing until `useAuthStatus` confirms auth is configured, so the default
 * local-first deployment never shows a token surface it cannot serve.
 */

/** Mirrors TOKEN_SCOPES in lib/services/tokens.ts; the server re-validates. */
const SCOPE_OPTIONS = [
  { id: "graph:read", label: "Read graph", hint: "List and inspect nodes, edges, and journal" },
  { id: "graph:write", label: "Write graph", hint: "Create, update, and delete nodes and edges" },
  { id: "synk", label: "Synk backups", hint: "Read and write project backups" },
] as const;

const DEFAULT_SCOPES = ["graph:read", "graph:write"];

interface TokenRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function isExpired(token: TokenRecord): boolean {
  return token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now();
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label="Copy token to clipboard"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

export function TokenManager() {
  const status = useAuthStatus();
  const [tokens, setTokens] = useState<TokenRecord[] | null>(null);
  /**
   * Why this exists instead of `setTokens([])` on failure (audit
   * `quality-frontend-5`, with issue #362).
   *
   * An empty list is a fact about the account — "you have no tokens" — and a
   * failed read is the absence of any fact at all. Coercing one into the other
   * made a 500 render "No tokens yet.", which invites the reader to mint a
   * duplicate of a token they already have and cannot see. `RestoreDialog` keeps
   * the same distinction for the same reason; so does the projects listing's
   * "not-knowing must not look like not-backed-up" rule.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [minting, setMinting] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const scopeFieldId = useId();

  const signedIn = status.state === "signed-in";

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) {
        setLoadError(`Unable to load your tokens (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { tokens: TokenRecord[] };
      setTokens(body.tokens);
    } catch (err) {
      // The `void refresh()` call sites cannot await this, so an uncaught throw
      // here was an unhandled rejection and nothing on screen ever said so.
      console.error("[TokenManager] Failed to load tokens:", err);
      setLoadError(err instanceof Error ? err.message : "Unable to load your tokens.");
    }
  }, []);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  async function mint() {
    if (!name.trim() || scopes.length === 0) return;
    setMinting(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        toast.error(body.message ?? body.error ?? "Could not create the token.");
        return;
      }
      const body = (await res.json()) as { secret: string };
      setFreshSecret(body.secret);
      setName("");
      setScopes(DEFAULT_SCOPES);
      await refresh();
    } catch (err) {
      // A network throw used to reach nobody: the `finally` reset the button and
      // the rejection escaped, so the form simply went quiet.
      console.error("[TokenManager] Failed to create token:", err);
      toast.error("Could not create the token.");
    } finally {
      setMinting(false);
    }
  }

  async function revoke(token: TokenRecord) {
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        toast.error("Could not revoke the token.");
        return;
      }
      toast.success(`Revoked “${token.name}”.`);
      await refresh();
    } catch (err) {
      // Said out loud rather than left to the console: a revoke that silently
      // does nothing reads as a revoke that worked, and the token stays live.
      console.error("[TokenManager] Failed to revoke token:", err);
      toast.error("Could not revoke the token.");
    }
  }

  // Hidden entirely when auth is unconfigured — the local-first default.
  if (status.state === "loading" || status.state === "unconfigured") return null;

  if (!signedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent tokens</CardTitle>
          <CardDescription>Sign in to create tokens for the CLI and coding agents.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {freshSecret ? (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlertIcon className="size-4" />
              Copy this token now
            </CardTitle>
            <CardDescription>
              This is the only time it will be shown. It is stored hashed and cannot be recovered — if you
              lose it, revoke it and create another.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-3 py-2 font-mono text-sm">
              {freshSecret}
            </code>
            <CopyButton value={freshSecret} />
            <Button variant="ghost" size="sm" onClick={() => setFreshSecret(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create a token</CardTitle>
          <CardDescription>
            Give it to <code className="font-mono text-xs">arkaik</code> as{" "}
            <code className="font-mono text-xs">ARKAIK_TOKEN</code> so a coding agent can read and edit
            this account&rsquo;s projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            placeholder="What is this token for? e.g. “laptop — arkaik repo”"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            {/* `Label` + `Checkbox`, not a native <label> wrapping a native
                <input>: Radix's Checkbox is a <button>, which a wrapping label
                does not toggle — only the htmlFor/id pairing Radix forwards
                does. The box itself was previously unstyled, so it ignored the
                theme entirely (audit `shadcn-5`). */}
            {SCOPE_OPTIONS.map((scope) => (
              <Label
                key={scope.id}
                htmlFor={`${scopeFieldId}-${scope.id}`}
                className="items-start gap-2 text-sm font-normal"
              >
                <Checkbox
                  id={`${scopeFieldId}-${scope.id}`}
                  className="mt-1"
                  checked={scopes.includes(scope.id)}
                  onCheckedChange={(checked) =>
                    setScopes((prev) =>
                      checked === true ? [...prev, scope.id] : prev.filter((s) => s !== scope.id),
                    )
                  }
                />
                <span>
                  <span className="font-medium">{scope.label}</span>
                  <span className="block text-xs text-muted-foreground">{scope.hint}</span>
                </span>
              </Label>
            ))}
          </div>
          <div>
            <Button onClick={() => void mint()} disabled={minting || !name.trim() || scopes.length === 0}>
              {minting ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
              <span>Create token</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The error branch comes FIRST, and deliberately outranks a stale
              list: whatever is on screen after a failed refresh is no longer
              known to be current, and a mint or a revoke that did not land is
              exactly when that matters. */}
          {loadError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-destructive" role="status" aria-live="polite">
                {loadError}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : tokens === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {tokens.map((token) => {
                const dead = token.revokedAt !== null || isExpired(token);
                return (
                  <li key={token.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={dead ? "text-muted-foreground line-through" : "font-medium"}>
                          {token.name}
                        </span>
                        <code className="font-mono text-xs text-muted-foreground">
                          ark_{token.prefix}…
                        </code>
                        {token.revokedAt ? <Badge variant="outline">Revoked</Badge> : null}
                        {!token.revokedAt && isExpired(token) ? (
                          <Badge variant="outline">Expired</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{token.scopes.join(", ") || "no scopes"}</span>
                        <span>Created {formatDate(token.createdAt)}</span>
                        <span>Last used {formatDate(token.lastUsedAt)}</span>
                        {token.expiresAt ? <span>Expires {formatDate(token.expiresAt)}</span> : null}
                      </div>
                    </div>
                    {token.revokedAt === null ? (
                      <Button variant="ghost" size="sm" onClick={() => void revoke(token)}>
                        <Trash2Icon />
                        <span>Revoke</span>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
