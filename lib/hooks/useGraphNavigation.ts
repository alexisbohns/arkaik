"use client";

import { useState, useCallback } from "react";

export interface BreadcrumbEntry {
  nodeId: string;
  label: string;
}

export function useGraphNavigation() {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    new Set()
  );
  const [zoomLevel, setZoomLevel] = useState<number>(7);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);

  const expand = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, []);

  const collapse = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const navigateTo = useCallback((nodeId: string, label: string) => {
    setBreadcrumbs((prev) => {
      const existingIndex = prev.findIndex((b) => b.nodeId === nodeId);
      if (existingIndex !== -1) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { nodeId, label }];
    });
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    setZoomLevel((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    expandedNodeIds,
    zoomLevel,
    breadcrumbs,
    expand,
    collapse,
    navigateTo,
  };
}
