import { cn } from "@/lib/utils";

export type CodeLineKind = "add" | "del" | "muted";

export interface CodeLine {
  text: string;
  kind?: CodeLineKind;
}

interface CodeBlockProps {
  /** Small mono label above the block, e.g. a filename or a command. */
  title?: string;
  lines: readonly CodeLine[];
  className?: string;
}

const LINE_STYLES: Record<CodeLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  del: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  muted: "text-muted-foreground",
};

/**
 * The one mono block the tailored agent previews share: a diff, a validator
 * run, a tool call, a prompt excerpt. Lines are data, so a preview never
 * embeds markup; the block never sets its own outer height.
 */
export function CodeBlock({ title, lines, className }: CodeBlockProps) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-muted/30", className)}>
      {title && <div className="border-b px-3 py-1 font-mono text-[10px] text-muted-foreground">{title}</div>}
      <pre className="[overflow:auto] px-3 py-2 font-mono text-[11px] leading-5">
        {lines.map((line, i) => (
          <div key={i} className={cn("-mx-3 px-3 whitespace-pre", line.kind && LINE_STYLES[line.kind])}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
