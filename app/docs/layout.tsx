import { DocsMenuFab } from "@/components/docs/DocsMenuFab";
import { DocsSidebar } from "@/components/layout/DocsSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getDocsNavigation, getDocsSearchPages } from "@/lib/utils/docs";

export const runtime = "nodejs";

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both read the same cached index, so this costs one walk of the tree.
  const [navigation, searchPages] = await Promise.all([
    getDocsNavigation(),
    getDocsSearchPages(),
  ]);

  return (
    <SidebarProvider defaultOpen>
      {/* Space switcher, search and pages all live in the sidebar now. The
          header bar that used to carry the first two held nothing else, so it
          was a strip of chrome above every page for one button and one field —
          on mobile, `DocsMenuFab` opens the sheet instead. */}
      <DocsSidebar items={navigation} searchPages={searchPages} />
      <SidebarInset className="h-svh overflow-hidden">
        <div className="h-full overflow-auto">{children}</div>
      </SidebarInset>
      <DocsMenuFab />
    </SidebarProvider>
  );
}
