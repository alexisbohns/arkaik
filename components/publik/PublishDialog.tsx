"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportProject } from "@/lib/utils/export";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
}

interface PublishResult {
  url: string;
  ownerKey: string;
}

type CopiedField = "url" | "key" | null;

/** Structured 422 finding shape (lib/services/publik.ts `ValidationFinding`). */
interface PublikFinding {
  path?: string;
  message: string;
}

function formatRetryAfter(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function findingLabel(finding: PublikFinding): string {
  return finding.path ? `${finding.path}: ${finding.message}` : finding.message;
}

const MAX_SHOWN_FINDINGS = 5;

/**
 * Publish confirmation + result dialog (docs/spec/services.md § Publik →
 * Surfaces: "In-app Publish action"). Two stages:
 *  - confirm: states what becomes public (journal excluded, no retention
 *    guarantee) and triggers the publish.
 *  - success: shows the URL + owner key exactly once, with copy buttons and a
 *    save-your-key warning — the server never returns the key again.
 *
 * The bundle is built client-side via the same `exportProject` the canvas
 * "Export JSON" action uses (`localProvider.exportProject` through
 * `getProvider()`), then POSTed as-is — no `?include_journal=true` — so the
 * server's default journal strip (docs/spec/services.md § Publik → Protocol)
 * is the only place history gets removed.
 */
export function PublishDialog({ open, onOpenChange, projectId, projectTitle }: PublishDialogProps) {
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [findings, setFindings] = useState<string[] | null>(null);
  const [copiedField, setCopiedField] = useState<CopiedField>(null);

  // Fresh state every time the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setPublishing(false);
    setResult(null);
    setFindings(null);
    setCopiedField(null);
  }, [open]);

  async function handlePublish() {
    setPublishing(true);
    setFindings(null);
    try {
      const bundle = await exportProject(projectId);
      const res = await fetch("/api/publik", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      });

      if (res.status === 201) {
        const body = (await res.json()) as { url: string; owner_key: string };
        setResult({ url: body.url, ownerKey: body.owner_key });
        return;
      }

      if (res.status === 503) {
        toast.error("Publik sharing is not available on this deployment.");
        return;
      }

      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { findings?: PublikFinding[] } | null;
        const messages = body?.findings?.map(findingLabel) ?? [];
        setFindings(messages.length > 0 ? messages : ["This project failed validation and cannot be published."]);
        return;
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        toast.error(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many snapshots published from this network. Try again in about ${formatRetryAfter(retryAfter)}.`
            : "Too many snapshots published from this network. Try again later.",
        );
        return;
      }

      if (res.status === 413) {
        toast.error("This project is too large to publish (over 5 MB).");
        return;
      }

      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? `Publish failed (HTTP ${res.status}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Publish failed: ${message}`);
    } finally {
      setPublishing(false);
    }
  }

  async function copyValue(field: Exclude<CopiedField, null>, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1500);
    } catch {
      toast.error("Unable to copy to clipboard.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Published</DialogTitle>
              <DialogDescription>
                Your project is live at the URL below. Save the owner key now — it is shown only once and is
                required to delete this snapshot later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Share URL</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={result.url}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="Share URL"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 cursor-pointer"
                    onClick={() => void copyValue("url", result.url)}
                    aria-label="Copy share URL"
                  >
                    {copiedField === "url" ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Owner key</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={result.ownerKey}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="Owner key"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 cursor-pointer"
                    onClick={() => void copyValue("key", result.ownerKey)}
                    aria-label="Copy owner key"
                  >
                    {copiedField === "key" ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                  </Button>
                </div>
                <p className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-500">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  Save this key somewhere safe. It will not be shown again, and there is no way to delete this
                  snapshot without it.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={result.url} target="_blank" rel="noreferrer">
                  Open link
                </a>
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Publish &quot;{projectTitle}&quot; to Publik</DialogTitle>
              <DialogDescription>
                Anyone with the link can view and import a copy. Your project&apos;s title, description, nodes, and
                edges become public — the journal (change history) is never included. There is no listing; only
                people with the URL can find it, and arkaik makes no retention guarantee.
              </DialogDescription>
            </DialogHeader>

            {findings && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium">This project can&apos;t be published yet:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {findings.slice(0, MAX_SHOWN_FINDINGS).map((finding, index) => (
                    <li key={index}>{finding}</li>
                  ))}
                </ul>
                {findings.length > MAX_SHOWN_FINDINGS && (
                  <p className="mt-1">and {findings.length - MAX_SHOWN_FINDINGS} more.</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
                Cancel
              </Button>
              <Button onClick={() => void handlePublish()} disabled={publishing} className="cursor-pointer">
                {publishing ? "Publishing..." : "Publish"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
