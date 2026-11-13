import type { Metadata, Viewport } from "next";
import { inclusiveSans } from "@/lib/font-sans";
import { GeistMono } from "geist/font/mono";
import "highlight.js/styles/github.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query/QueryProvider";
import { AppToaster } from "@/components/ui/toaster";
import { SyncProvider } from "@/components/sync/SyncProvider";
import { WobbleFilters } from "@/components/wobble/WobbleFilters";
import { WobbleBoil } from "@/components/wobble/WobbleBoil";
import { StoneDefs } from "@/components/stones/StoneDefs";
import { DEFAULT_STONES } from "@/lib/stones/stones-registry.generated";
import { stoneBootScript } from "@/lib/stones/preferences";

export const metadata: Metadata = {
  title: "arkaik",
  description: "Product graph browser for product architects. Map your product as an interactive graph with flows, views, data models, and API endpoints.",
  metadataBase: new URL("https://arkaik.app"),
  openGraph: {
    title: "arkaik",
    description: "Product graph browser for product architects",
    url: "https://arkaik.app",
    siteName: "arkaik",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "arkaik",
    description: "Product graph browser for product architects",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: "https://arkaik.app",
  },
  appleWebApp: {
    capable: true,
    title: "arkaik",
    statusBarStyle: "default",
  },
};

// The installed app's title bar (app/manifest.ts) follows the system theme,
// on the Basalt surfaces (app/m3/basalt.css: --md-surface, light and dark).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9F9F9" },
    { media: "(prefers-color-scheme: dark)", color: "#131315" },
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "arkaik",
  description: "Product graph browser for product architects. Map your product as an interactive graph with flows, views, data models, and API endpoints.",
  url: "https://arkaik.app",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inclusiveSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
      data-stone-light={DEFAULT_STONES.light}
      data-stone-dark={DEFAULT_STONES.dark}
    >
      <head>
        {/* Applies the reader's stones before first paint (lib/stones/preferences.ts). */}
        <script dangerouslySetInnerHTML={{ __html: stoneBootScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <WobbleFilters />
        <WobbleBoil />
        <StoneDefs />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            {children}
            <AppToaster />
            <SyncProvider />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
