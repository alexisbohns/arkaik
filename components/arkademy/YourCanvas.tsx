"use client";

import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { ChevronDownIcon, DownloadIcon, InfoIcon, RotateCwIcon } from "lucide-react";

import { ARKADEMY_SECTION_TITLE } from "@/components/arkademy/ArkademyChrome";
import { CanvasGrid } from "@/components/arkademy/CanvasGrid";
import { CanvasLink } from "@/components/arkademy/CanvasLink";
import { CanvasToolbar } from "@/components/arkademy/CanvasToolbar";
import { InspirationList } from "@/components/arkademy/InspirationList";
import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { ADD_ANSWER_ID, isEnter, QUESTION_TITLE_ID, QuestionEditor, type AddResult } from "@/components/arkademy/QuestionEditor";
import { ARKADEMY_KICKER } from "@/components/arkademy/QuestionCard";
import { QuestionSteps } from "@/components/arkademy/QuestionSteps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  answersOf,
  draftIsEmpty,
  draftState,
  hasAnswerText,
  hasWords,
  NAME_MAX_LENGTH,
  questionStatus,
  yoursHref,
  type CanvasDraft,
} from "@/lib/arkademy/canvas";
import {
  canvasFilename,
  canvasJson,
  canvasJsonText,
  canvasMarkdown,
  canvasParagraphText,
  type CanvasTool,
} from "@/lib/arkademy/canvas-export";
import { UNREADABLE_DRAFT_FILENAME } from "@/lib/arkademy/canvas-storage";
import { availableInspirations, type Inspiration } from "@/lib/arkademy/inspirations";
import { composeParagraph, DEFAULT_SUBJECT, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import { BMC_TOOL_ID, MAX_ANSWERS_PER_QUESTION, type BmcQuestion, type BmcQuestionKey } from "@/lib/arkademy/schema";
import { ARKADEMY_TOOL_PATHS } from "@/lib/arkademy/tools";
import { dismissUnreadableDraft, dispatchDraft, useCanvasDraft, type DraftPersistence } from "@/lib/hooks/useCanvasDraft";
import { downloadTextFile } from "@/lib/utils/download";
import { cn } from "@/lib/utils";

interface YourCanvasProps {
  /** The tool's title and its nine questions. */
  tool: CanvasTool;
  /** `inspirationCatalog`, built on the server. */
  catalog: Record<BmcQuestionKey, Inspiration[]>;
  /** The library version this page was served with: kept on inspired answers and in the JSON export. */
  documentVersion: number;
  /** `?step=` as the server read it, or null. */
  initialStep: number | null;
}

const NAME_ID = "canvas-name";
const PARAGRAPH_TITLE_ID = "canvas-paragraph-title";
const QUESTION_CARD_ID = "canvas-question";
const INSPIRATIONS_ID = "canvas-inspirations";
const COVER_PATH = ARKADEMY_TOOL_PATHS[BMC_TOOL_ID];

/**
 * The current question's sentence, underlined in the paragraph. An underline,
 * not a tint: hovering a sentence or a block tints the sentence (`CanvasLink`),
 * and the two must never be mistaken for one another. Literal class names, so
 * Tailwind finds them.
 */
const CURRENT_SENTENCE: Record<BmcQuestionKey, string> = {
  seg: "[&_[data-kind=sentence][data-question=seg]]:underline",
  vp: "[&_[data-kind=sentence][data-question=vp]]:underline",
  ch: "[&_[data-kind=sentence][data-question=ch]]:underline",
  cr: "[&_[data-kind=sentence][data-question=cr]]:underline",
  rev: "[&_[data-kind=sentence][data-question=rev]]:underline",
  kr: "[&_[data-kind=sentence][data-question=kr]]:underline",
  ka: "[&_[data-kind=sentence][data-question=ka]]:underline",
  kp: "[&_[data-kind=sentence][data-question=kp]]:underline",
  cost: "[&_[data-kind=sentence][data-question=cost]]:underline",
};
/** How that underline looks; decoration colour and thickness are not inherited, so they go on the sentence itself. */
const UNDERLINE_STYLE =
  "[&_[data-kind=sentence]]:decoration-muted-foreground/60 [&_[data-kind=sentence]]:decoration-2 [&_[data-kind=sentence]]:underline-offset-[5px]";

/** A character no answer holds, standing in for the answer still to come. */
const BLANK = "";

/**
 * Your own canvas (spec § "Your own canvas"): the name, the nine questions one
 * at a time with their inspirations, the paragraph and the canvas building as
 * the visitor types, and the exports. The draft lives in this browser only
 * (`useCanvasDraft`). The server and the first client render draw a skeleton;
 * the editor mounts once the stored draft has been read.
 */
export function YourCanvas(props: YourCanvasProps) {
  const view = useCanvasDraft();
  if (view.phase === "loading") return <YourCanvasSkeleton />;
  return (
    <CanvasEditor
      {...props}
      draft={view.draft}
      startStep={view.startStep}
      persistence={view.persistence}
      unreadable={view.unreadable}
    />
  );
}

function CanvasEditor({
  tool,
  catalog,
  documentVersion,
  initialStep,
  draft,
  startStep,
  persistence,
  unreadable,
}: YourCanvasProps & {
  draft: CanvasDraft;
  startStep: number;
  persistence: DraftPersistence;
  unreadable: string | null;
}) {
  const [step, setStep] = useState(initialStep ?? startStep);
  const [inspirationsShown, setInspirationsShown] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const questions = tool.questions;
  const question = questions[step - 1];
  const state = draftState(draft);
  const statuses = state.map(questionStatus);
  const segments = composeParagraph({ questions, state, subject: draft.name });
  const paragraph = canvasParagraphText({ tool, name: draft.name, state });
  const answers = answersOf(draft, question.key);
  const open = answers.length === 0 && draft.open.includes(question.key);
  const full = answers.length >= MAX_ANSWERS_PER_QUESTION;
  const catalogForQuestion = catalog[question.key] ?? [];
  const inspirations = availableInspirations(catalogForQuestion, answers);
  const hasContent = !draftIsEmpty(draft);
  const answeredCount = statuses.filter((status) => status === "answered").length;
  const openCount = statuses.filter((status) => status === "open").length;
  const complete = statuses.every((status) => status !== "empty");

  /** Moves to a question. Focus follows: its add field for the keyboard flow, else its heading. */
  function goTo(target: number, focus: "add" | "heading") {
    const next = Math.min(Math.max(target, 1), questions.length);
    flushSync(() => setStep(next));
    window.history.replaceState(null, "", yoursHref(next));
    const field = document.getElementById(ADD_ANSWER_ID);
    if (focus === "add" && field instanceof HTMLTextAreaElement && !field.disabled) {
      field.focus();
      return;
    }
    document.getElementById(QUESTION_TITLE_ID)?.focus({ preventScroll: true });
    document.getElementById(QUESTION_CARD_ID)?.scrollIntoView({ block: "nearest" });
  }

  function goToQuestion(key: BmcQuestionKey) {
    goTo(questions.findIndex((entry) => entry.key === key) + 1, "heading");
  }

  function readParagraph() {
    const heading = document.getElementById(PARAGRAPH_TITLE_ID);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }

  function next(fromKeyboard: boolean) {
    if (step === questions.length) readParagraph();
    else goTo(step + 1, fromKeyboard ? "add" : "heading");
  }

  function addAnswer(text: string): AddResult {
    if (full) return "full";
    if (!hasWords(text)) return "empty";
    if (hasAnswerText(draft, question.key, text)) return "duplicate";
    dispatchDraft({ type: "add", question: question.key, text });
    return "added";
  }

  function addInspiration(item: Inspiration, event: MouseEvent<HTMLButtonElement>) {
    flushSync(() =>
      dispatchDraft({
        type: "addInspiration",
        question: question.key,
        entity: item.entity,
        text: item.answer,
        documentVersion,
      }),
    );
    setAnnouncement(`Added: ${item.label}`);
    // From the keyboard, back to the add field to reword or go on; from a
    // pointer, the heading, without scrolling (a touch keyboard would hide the list).
    const field = document.getElementById(ADD_ANSWER_ID);
    if (event.detail === 0 && field instanceof HTMLTextAreaElement && !field.disabled) field.focus();
    else document.getElementById(QUESTION_TITLE_ID)?.focus({ preventScroll: true });
  }

  function download() {
    const filename = canvasFilename(draft.name);
    const exported = canvasJson({ tool, name: draft.name, state, documentVersion, exportedAt: new Date().toISOString() });
    downloadTextFile(filename, canvasJsonText(exported));
    toast.success(`Downloaded ${filename}.`);
  }

  function startOver() {
    flushSync(() => {
      dispatchDraft({ type: "reset" });
      setStep(1);
    });
    window.history.replaceState(null, "", yoursHref(1));
    setAnnouncement("Your canvas is empty again.");
    toast.success("Started over.");
  }

  return (
    <div className="flex flex-col gap-8">
      <Notices
        persistence={persistence}
        unreadable={unreadable}
        hasContent={hasContent}
        onDownload={download}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={NAME_ID}>Your product&apos;s name</Label>
        <Input
          id={NAME_ID}
          value={draft.name}
          maxLength={NAME_MAX_LENGTH}
          placeholder={DEFAULT_SUBJECT}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => dispatchDraft({ type: "rename", name: event.target.value })}
          onKeyDown={(event) => {
            if (!isEnter(event)) return;
            event.preventDefault();
            document.getElementById(ADD_ANSWER_ID)?.focus();
          }}
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">
          It opens your paragraph. {persistence === "on" && "Saved in this browser only."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <QuestionSteps questions={questions} statuses={statuses} current={step} onSelect={(n) => goTo(n, "heading")} />
          <p className={ARKADEMY_KICKER}>
            {answeredCount} of {questions.length} answered{openCount > 0 && ` · ${openCount} left open`}
          </p>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <div id={QUESTION_CARD_ID} className="min-w-0 scroll-mt-4">
            <QuestionEditor
              key={question.key}
              question={question}
              step={step}
              total={questions.length}
              answers={answers}
              open={open}
              preview={<SentencePreview questions={questions} state={state} subject={draft.name} question={question} />}
              onAdd={addAnswer}
              onEdit={(id, text) => dispatchDraft({ type: "edit", id, text })}
              onRemove={(id) => dispatchDraft({ type: "remove", id })}
              onMove={(id, offset) => dispatchDraft({ type: "move", id, offset })}
              onSetOpen={(value) => dispatchDraft({ type: "setOpen", question: question.key, open: value })}
              onBack={() => goTo(step - 1, "heading")}
              onNext={next}
            />
          </div>
          {catalogForQuestion.length > 0 && (
            <div className="min-w-0">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between md:hidden"
                aria-expanded={inspirationsShown}
                aria-controls={INSPIRATIONS_ID}
                onClick={() => setInspirationsShown(!inspirationsShown)}
              >
                {inspirationsShown ? "Hide inspirations" : `Stuck? ${inspirations.length} inspirations`}
                <ChevronDownIcon aria-hidden="true" className={cn("transition-transform", inspirationsShown && "rotate-180")} />
              </Button>
              <InspirationList
                key={question.key}
                id={INSPIRATIONS_ID}
                items={inspirations}
                full={full}
                onAdd={addInspiration}
                className={cn("mt-3 md:mt-0 md:block", inspirationsShown ? "block" : "hidden")}
              />
            </div>
          )}
        </div>
      </div>

      {/* One CanvasLink around the paragraph and the canvas: a sentence and its block light each other up. */}
      <CanvasLink className="contents">
        <Card className="gap-4 p-4 sm:p-6">
          <div>
            <h2 id={PARAGRAPH_TITLE_ID} tabIndex={-1} className={cn(ARKADEMY_SECTION_TITLE, "scroll-mt-4 outline-none")}>
              Your paragraph
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One sentence per answered question. A gap takes you to its question.
            </p>
          </div>
          <ParagraphView
            segments={segments}
            onSelectQuestion={goToQuestion}
            className={cn("max-w-[72ch]", UNDERLINE_STYLE, CURRENT_SENTENCE[question.key])}
          />
          <CanvasToolbar
            paragraph={paragraph}
            markdown={canvasMarkdown({ tool, name: draft.name, state })}
            hasContent={hasContent}
            onDownload={download}
            onStartOver={startOver}
            focusAfterStartOver={NAME_ID}
          />
          {complete && (
            <p className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">
              Every question is answered or left open on purpose. Paste your paragraph into{" "}
              <Link href={`${COVER_PATH}#prompt-title`} className="text-foreground underline underline-offset-4">
                the baseline prompt
              </Link>
              , or download the canvas to keep it.
            </p>
          )}
        </Card>

        <section aria-labelledby="canvas-grid-title" className="flex flex-col gap-3">
          <div>
            <h2 id="canvas-grid-title" className={ARKADEMY_SECTION_TITLE}>
              The canvas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">A block&apos;s title takes you to its question.</p>
          </div>
          <CanvasGrid
            questions={questions}
            state={state}
            density="full"
            idPrefix="yours"
            label="Your canvas"
            current={question.key}
            onSelectQuestion={goToQuestion}
          />
        </section>
      </CanvasLink>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/**
 * What the current question adds to the paragraph: its sentence, its
 * "left open on purpose" pill, or — before any answer — its sentence with a
 * blank where the answer goes ("This product is for ___."), which is how a
 * first visit sees what the tool does.
 */
function SentencePreview({
  questions,
  state,
  subject,
  question,
}: {
  questions: readonly BmcQuestion[];
  state: readonly CanvasQuestionState[];
  subject: string;
  question: BmcQuestion;
}) {
  const own = composeParagraph({ questions, state, subject }).find((segment) => segment.question === question.key);
  if (own && (own.kind === "sentence" || own.open)) return <ParagraphView segments={[own]} />;

  const withBlank = state.map((entry) =>
    entry.key === question.key ? { key: entry.key, answers: [{ text: BLANK }], open: false } : entry,
  );
  const blank = composeParagraph({ questions, state: withBlank, subject }).find(
    (segment) => segment.question === question.key,
  );
  const [before, after = ""] = blank && blank.kind === "sentence" ? blank.text.split(BLANK) : [""];
  return (
    <p className="text-[15px] leading-7 text-muted-foreground">
      {before}
      <span className="inline-block w-16 translate-y-[3px] border-b-2 border-dashed border-muted-foreground/50">
        <span className="sr-only">your answer</span>
      </span>
      {after}
    </p>
  );
}

function Notices({
  persistence,
  unreadable,
  hasContent,
  onDownload,
}: {
  persistence: DraftPersistence;
  unreadable: string | null;
  hasContent: boolean;
  onDownload: () => void;
}) {
  if (persistence === "on" && unreadable === null) return null;
  return (
    <div role="status" className="flex flex-col gap-3">
      {persistence === "unavailable" && (
        <Notice
          text="This browser is not saving your canvas: its storage is off or full. Download JSON before you leave to keep a copy."
          action={
            <Button type="button" variant="outline" size="sm" disabled={!hasContent} onClick={onDownload}>
              <DownloadIcon aria-hidden="true" />
              Download JSON
            </Button>
          }
        />
      )}
      {persistence === "newer" && (
        <Notice
          text="A newer version of this page saved your canvas. Reload to keep working on it; changes made here are not saved."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RotateCwIcon aria-hidden="true" />
              Reload
            </Button>
          }
        />
      )}
      {unreadable !== null && (
        <Notice
          text="A canvas saved here earlier could not be read, so this one starts empty. Its text is kept aside in this browser."
          action={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTextFile(UNREADABLE_DRAFT_FILENAME, unreadable, "text/plain")}
              >
                <DownloadIcon aria-hidden="true" />
                Download the old text
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={dismissUnreadableDraft}>
                Dismiss
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function Notice({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-muted-foreground/45 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm leading-relaxed">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {text}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
    </div>
  );
}

/** The server render and the first client frame: the editor's shape, before the stored draft is read. */
function YourCanvasSkeleton() {
  return (
    <div role="status" aria-label="Loading your canvas" className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="hidden h-72 rounded-xl md:block" />
        </div>
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
