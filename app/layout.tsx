import type { Metadata, Viewport } from "next";
import { inclusiveSans } from "@/lib/font-sans";
import { GeistMono } from "geist/font/mono";
import "highlight.js/styles/github.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query/QueryProvider";
import { AppToaster } from "@/components/ui/toaster";
import { SyncProvider } from "@/components/sync/SyncProvider";
import { PANEL_PREFERENCES_SCRIPT } from "@/lib/config/panel-preferences";

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

/**
 * Records the last input modality on <html data-modality>: "pointer" on
 * pointerdown, "keyboard" on any key without a command modifier. Read by
 * app/m3/controls.css, which drops the controls' focus ring while the pointer
 * is driving — Radix hands focus back to a trigger after a mouse pick, and
 * Chrome counts that programmatic focus as :focus-visible. Inline and
 * capture-phase, so it is in place before hydration and before any handler
 * can stop the event.
 */
const INPUT_MODALITY_SCRIPT = `(function(){var d=document.documentElement;function s(m){if(d.dataset.modality!==m)d.dataset.modality=m}addEventListener("pointerdown",function(){s("pointer")},true);addEventListener("keydown",function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;s("keyboard")},true)})();`;

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
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: INPUT_MODALITY_SCRIPT }} />
        {/* The reader's panel look, on <html> before first paint (panels.css). */}
        <script dangerouslySetInnerHTML={{ __html: PANEL_PREFERENCES_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
