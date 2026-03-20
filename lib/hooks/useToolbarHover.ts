"use client";

import { useState, useRef } from "react";

/** Delay (ms) before hiding the node toolbar after the cursor leaves. */
export const TOOLBAR_HIDE_DELAY_MS = 150;

/**
 * Manages hover state for a NodeToolbar, keeping it visible for a short delay
 * after the cursor leaves the node — long enough for the user to move onto the
 * toolbar button without it disappearing.
 *
 * Usage: spread `nodeProps` on the node element and `toolbarProps` on the
 * NodeToolbar button.
 */
export function useToolbarHover() {
  const [isHovered, setIsHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function showToolbar() {
    clearTimeout(hideTimer.current);
    setIsHovered(true);
  }

  function scheduleHide() {
    hideTimer.current = setTimeout(() => setIsHovered(false), TOOLBAR_HIDE_DELAY_MS);
  }

  return {
    isHovered,
    nodeProps: {
      onMouseEnter: showToolbar,
      onMouseLeave: scheduleHide,
    },
    toolbarProps: {
      onMouseEnter: showToolbar,
      onMouseLeave: scheduleHide,
    },
  };
}
