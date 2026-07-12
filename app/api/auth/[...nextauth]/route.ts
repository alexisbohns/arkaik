import { handlers } from "@/auth";

/**
 * Auth.js catch-all route (docs/spec/services.md § Synk → Auth). Handles
 * `/api/auth/signin`, `/api/auth/callback/github`, `/api/auth/session`, etc.
 *
 * Re-exporting `handlers` is inert at import: NextAuth's config is lazy
 * (auth.ts), so this file adds no env reads and does not break the env-unset
 * build. The GitHub OAuth callback URL a deployment must register is
 * `<origin>/api/auth/callback/github`.
 */
export const { GET, POST } = handlers;
