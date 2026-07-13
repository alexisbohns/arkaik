"use client";

import { GithubIcon, LogOutIcon, UserRoundIcon } from "lucide-react";
import { signIn, signOut } from "next-auth/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStatus, type AuthStatusUser } from "@/lib/hooks/useAuthStatus";

/**
 * Sign-in / account entry point for the app shell (docs/spec/services.md
 * § Synk → Auth). Native to the existing chrome — an icon-sized control that
 * sits beside the theme toggle / in the sidebar footer.
 *
 * GRACEFUL ABSENCE: `useAuthStatus` asks GET /api/auth/status once on mount and
 * this renders *nothing* until it knows auth is configured. When it is not (the
 * default local-first deployment), this stays null forever — no sign-in affords,
 * no services surface leaks, and local-first usage is untouched. The endpoint
 * returns only a boolean and the public profile; no secret reaches the client.
 *
 * Signed-out state gates no local feature: this button is the *only* thing that
 * changes between signed-in and signed-out.
 */

function initials(user: AuthStatusUser): string {
  const source = user.name ?? user.email ?? "";
  const trimmed = source.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "";
}

export function AuthButton() {
  const status = useAuthStatus();

  // Hidden while loading and whenever auth is not configured.
  if (status.state === "loading" || status.state === "unconfigured") {
    return null;
  }

  if (status.state === "signed-out") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void signIn("github")}
        aria-label="Sign in with GitHub"
      >
        <GithubIcon />
        <span>Sign in</span>
      </Button>
    );
  }

  const { user } = status;
  const label = user.name ?? user.email ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label={`Account menu for ${label}`}
        >
          {initials(user) ? (
            <span className="text-xs font-semibold">{initials(user)}</span>
          ) : (
            <UserRoundIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          {user.name ? <span className="truncate text-sm">{user.name}</span> : null}
          {user.email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => void signOut()}
        >
          <LogOutIcon />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
