/**
 * The sandbox disclaimer for the public self-map (self-map cycle 4), shown in
 * the project sidebar. Deliberately just the notice: the Reset / Import-a-copy
 * actions live in the project switcher menu, where project-scoped actions go.
 */
export function SeedSandboxNotice() {
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-400/30 dark:text-amber-300 group-data-[collapsible=icon]:hidden">
      You&apos;re exploring Arkaik&apos;s own map. Changes stay in this tab and vanish on refresh.
    </div>
  );
}
