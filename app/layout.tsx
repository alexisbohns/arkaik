import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "highlight.js/styles/github.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppToaster } from "@/components/ui/toaster";

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
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
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
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
