import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ArkademyMessage } from "@/components/arkademy/ArkademyMessage";
import { ToolCard } from "@/components/arkademy/ToolCard";
import { ARKADEMY_INTRO, arkademyShellMetadata } from "@/lib/arkademy/metadata";
import { arkademyToolCards } from "@/lib/arkademy/tools";
import { getArkademy } from "@/lib/services/arkademy";
import { cn } from "@/lib/utils";

/**
 * `/arkademy` — the shell: the Arkademy's name, one line on what it is, and a
 * card per tool. The cards are the only part that reads the library.
 * force-dynamic: the library is a runtime fact; the build never reads it.
 */
export const dynamic = "force-dynamic";

export const metadata = arkademyShellMetadata();

export default async function ArkademyShellPage() {
  const lookup = await getArkademy();
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-10 pb-24 sm:pt-14")}>
      <h1 className={ARKADEMY_TITLE}>Arkademy</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{ARKADEMY_INTRO}</p>
      <section aria-labelledby="arkademy-tools" className="mt-12">
        <h2 id="arkademy-tools" className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Tools
        </h2>
        <div className="mt-4">
          {lookup.status === "ready" ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {arkademyToolCards(lookup.document).map((card) => (
                <li key={card.id}>
                  <ToolCard
                    href={card.href}
                    title={card.title}
                    tagline={card.tagline}
                    exampleCount={card.exampleCount}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ArkademyMessage status={lookup.status} />
          )}
        </div>
      </section>
    </div>
  );
}
