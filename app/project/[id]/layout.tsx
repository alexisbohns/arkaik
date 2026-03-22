"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { cn } from "@/lib/utils";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const navItems = [
    { label: "Canvas", href: `/project/${id}/canvas`, active: pathname.startsWith(`/project/${id}/canvas`) },
    { label: "Library", href: `/project/${id}/library`, active: pathname.startsWith(`/project/${id}/library`) },
  ];

  return (
    <div className="h-screen w-full overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-background/95 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project</span>
        <nav className="flex items-center gap-1" aria-label="Project views">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors",
                item.active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="h-[calc(100vh-41px)]">{children}</div>
    </div>
  );
}
