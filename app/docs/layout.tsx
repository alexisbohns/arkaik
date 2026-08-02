import { DocsSearch } from "@/components/docs/DocsSearch";
import { DocsSidebar } from "@/components/layout/DocsSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
      <DocsSidebar items={navigation} />
      <SidebarInset className="h-svh overflow-hidden">
        <div className="flex h-full flex-col">
          <header className="flex h-11 items-center gap-2 border-b px-3">
            <SidebarTrigger />
            <span className="text-sm font-medium">Documentation</span>
            <DocsSearch pages={searchPages} className="ml-auto" />
          </header>
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
