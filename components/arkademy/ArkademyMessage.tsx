import { EmptyState } from "@/components/ui/empty-state";
import type { ArkademyLookup } from "@/lib/services/arkademy";

/** Every lookup but `ready`: the reasons a page has no library to show. */
export type ArkademyMessageStatus = Exclude<ArkademyLookup["status"], "ready">;

const MESSAGES: Record<ArkademyMessageStatus, string> = {
  unconfigured: "The Arkademy's library lives in this deployment's database, which is not configured here.",
  empty: "The library is being stocked. Come back soon.",
  invalid: "The Arkademy could not be loaded right now. Please try again shortly.",
  error: "The Arkademy could not be loaded right now. Please try again shortly.",
};

/**
 * What a page shows in place of the library when there is none (spec § "States
 * without a document"). The page keeps its own `h1`; this is the body. In
 * development an empty table also names the command that fills it.
 *
 * No hooks, so a server page or a client screen can render it.
 */
export function ArkademyMessage({ status }: { status: ArkademyMessageStatus }) {
  const showCommand = status === "empty" && process.env.NODE_ENV !== "production";
  return (
    <EmptyState
      message={
        <>
          {MESSAGES[status]}
          {showCommand && (
            <span className="mt-2 block">
              Publish one with <code className="font-mono text-xs text-foreground">npm run arkademy -- publish</code>.
            </span>
          )}
        </>
      }
    />
  );
}
