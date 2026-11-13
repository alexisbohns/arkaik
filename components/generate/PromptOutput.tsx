"use client";

import { useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PromptOutputProps {
  prompt: string;
  tokenCount: number;
  compact?: boolean;
}

export function PromptOutput({ prompt, tokenCount, compact }: PromptOutputProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    if (!prompt) return;
    const blob = new Blob([prompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "arkaik-prompt.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {prompt ? `~${tokenCount.toLocaleString()} tokens` : "Fill the form to generate a prompt"}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!prompt}>
            <Download className="size-3.5 mr-1" />
            .txt
          </Button>
          <Button size="sm" onClick={handleCopy} disabled={!prompt}>
            {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
            {copied ? "Copied!" : "Copy prompt"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 sticky top-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Generated Prompt</span>
          {prompt && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              ~{tokenCount.toLocaleString()} tokens
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!prompt}>
            <Download className="size-3.5 mr-1" />
            .txt
          </Button>
          <Button size="sm" onClick={handleCopy} disabled={!prompt}>
            {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
            {copied ? "Copied!" : "Copy prompt"}
          </Button>
        </div>
      </div>

      <div className="flex-1 rounded-xl border bg-muted/30 p-4 overflow-auto max-h-[calc(100vh-10rem)]">
        {prompt ? (
          <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed text-foreground">
            {prompt}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            Fill in the form to generate your prompt.
            <br />
            <span className="text-xs">The prompt will appear here in real-time.</span>
          </p>
        )}
      </div>
    </div>
  );
}
