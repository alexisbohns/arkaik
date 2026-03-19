import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const nodes = [
  { id: "1", title: "Pebbles", species: "Product", status: "Live" },
  { id: "2", title: "Record a Pebble", species: "Scenario", status: "In Development" },
  { id: "3", title: "Shape an Emotion", species: "Flow", status: "Planned" },
];

export default function Home() {
  return (
    <div className="flex flex-col flex-1 bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">arkaik</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Components</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col gap-8 p-6 max-w-4xl mx-auto w-full">
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Input</h2>
          <div className="flex flex-col gap-3 max-w-sm">
            <Input type="text" placeholder="Search nodes…" />
            <div className="flex gap-2">
              <Input type="text" placeholder="Node title" />
              <Button>Add</Button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Card</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Pebbles</CardTitle>
                <CardDescription>Product · Live</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  A product graph of the Pebbles app, from tokens to scenarios.
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm">Open</Button>
                <Button size="sm" variant="outline">Export</Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Shape an Emotion</CardTitle>
                <CardDescription>Flow · Planned</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  The flow that guides users through the emotion-shaping process.
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="secondary">View graph</Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Table</h2>
          <Table>
            <TableCaption>Graph nodes overview</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Species</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.title}</TableCell>
                  <TableCell>{node.species}</TableCell>
                  <TableCell>{node.status}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Sheet</h2>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open detail panel</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Node detail</SheetTitle>
                <SheetDescription>
                  Inspect and edit the properties of this graph node.
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 p-6">
                <Input placeholder="Node title" defaultValue="Shape an Emotion" />
                <Button>Save changes</Button>
              </div>
            </SheetContent>
          </Sheet>
        </section>
      </main>
    </div>
  );
}
