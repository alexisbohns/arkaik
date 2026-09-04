"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Production safety net only: a preview that throws renders an empty frame
 * with one line, never a broken page. The real gate is tests/landing — a
 * fixture id that stops resolving fails CI, it does not reach this boundary.
 */
export class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Preview unavailable.
        </p>
      );
    }
    return this.props.children;
  }
}
