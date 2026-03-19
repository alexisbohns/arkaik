interface SidebarProps {
  children?: React.ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="flex flex-col w-64 border-r bg-background h-full">
      {children}
    </aside>
  );
}
