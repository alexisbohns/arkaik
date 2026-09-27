import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes arkaik installable as a desktop app (Chrome /
 * Edge "Install arkaik", Safari "Add to Dock").
 *
 * `start_url` is `/projects`, not `/`: an installed app opens on the work, and
 * the landing page would only pitch a choice the user already made by
 * installing. `id` stays `/` so the install identity survives a later change of
 * start page.
 *
 * The colors mirror the light theme's `--background` in globals.css; the title
 * bar follows the system theme through `viewport.themeColor` in the root
 * layout, which overrides `theme_color` once a page is loaded.
 *
 * The maskable icon (what macOS turns into the Dock icon) and app/apple-icon.png
 * are the mark inverted on a dark tile, on purpose. A web app cannot ship
 * dark/clear icon variants, so macOS derives them by darkening the tile — a
 * white tile went near-black and swallowed the black mark. A dark tile with a
 * light shape survives that in every icon style.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "arkaik",
    short_name: "arkaik",
    description: "Product graph browser for product architects",
    start_url: "/projects",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f7",
    theme_color: "#f7f7f7",
    categories: ["developer", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
