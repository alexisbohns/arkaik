"use client";

import { CopyIcon, DownloadIcon, RotateCcwIcon } from "lucide-react";

import { CopyButton } from "@/components/arkademy/CopyButton";
import { ConfirmDialog } from "@/components/arkademy/ConfirmDialog";
import { Button } from "@/components/ui/button";

interface CanvasToolbarProps {
  /** `canvasParagraphText`: empty until a question is answered. */
  paragraph: string;
  /** `canvasMarkdown`. */
  markdown: string;
  /** The draft holds something (a name, an answer, an open question). */
  hasContent: boolean;
  onDownload: () => void;
  onStartOver: () => void;
  /** The field that takes the focus once the canvas is cleared. */
  focusAfterStartOver: string;
}

/**
 * The paragraph card's actions: the three exports (spec § "Exports") and
 * Start over, which asks first in the app's destructive confirmation
 * (`ConfirmDialog`: Cancel, then the red action). A copy button with
 * nothing to copy is drawn disabled rather than copying an empty string.
 */
export function CanvasToolbar({
  paragraph,
  markdown,
  hasContent,
  onDownload,
  onStartOver,
  focusAfterStartOver,
}: CanvasToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {paragraph ? (
        <CopyButton text={paragraph} label="Copy the paragraph" what="the paragraph" />
      ) : (
        <Button type="button" variant="outline" size="sm" disabled>
          <CopyIcon aria-hidden="true" />
          Copy the paragraph
        </Button>
      )}
      {hasContent ? (
        <CopyButton text={markdown} label="Copy as Markdown" what="the canvas as Markdown" />
      ) : (
        <Button type="button" variant="outline" size="sm" disabled>
          <CopyIcon aria-hidden="true" />
          Copy as Markdown
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" disabled={!hasContent} onClick={onDownload}>
        <DownloadIcon aria-hidden="true" />
        Download JSON
      </Button>
      <ConfirmDialog
        trigger={
          <>
            <RotateCcwIcon aria-hidden="true" />
            Start over
          </>
        }
        disabled={!hasContent}
        title="Start over?"
        description="Your product's name and every answer leave this browser. Download JSON first if you want to keep a copy."
        confirmLabel="Start over"
        onConfirm={onStartOver}
        focusAfterConfirm={focusAfterStartOver}
      />
    </div>
  );
}
