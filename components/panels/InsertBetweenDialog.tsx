"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { Node as DataNode } from "@/lib/data/types";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";

export type InsertEntryType = "view" | "flow" | "condition" | "junction";

interface InsertBetweenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryType: InsertEntryType;
  onEntryTypeChange: (entryType: InsertEntryType) => void;
  allNodes: DataNode[];
  onSelectNode: (nodeId: string) => Promise<void> | void;
  onCreateNode: (title: string) => Promise<void> | void;
  onInsertStructured: (label: string) => Promise<void> | void;
  disabled?: boolean;
}

export function InsertBetweenDialog({
  open,
  onOpenChange,
  entryType,
  onEntryTypeChange,
  allNodes,
  onSelectNode,
  onCreateNode,
  onInsertStructured,
  disabled,
}: InsertBetweenDialogProps) {
  const fieldId = useId();
  const [label, setLabel] = useState("");
  const isNodeReference = entryType === "view" || entryType === "flow";

  function handleInsertStructured() {
    void onInsertStructured(label);
    setLabel("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert between</DialogTitle>
          <DialogDescription>
            Choose what to insert, then select an existing node or create a new one inline.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Type" htmlFor={`${fieldId}-type`}>
            <Select
              value={entryType}
              onValueChange={(value) => onEntryTypeChange(value as InsertEntryType)}
              disabled={disabled}
            >
              <SelectTrigger id={`${fieldId}-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">View</SelectItem>
                <SelectItem value="flow">Flow</SelectItem>
                <SelectItem value="condition">Condition</SelectItem>
                <SelectItem value="junction">Junction</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {isNodeReference && (
            // No `htmlFor`: `NodeSearchCombobox` owns its own input and takes no
            // `id`, so the label would point at nothing. It keeps its own name.
            <Field label="Search or create">
              <NodeSearchCombobox
                species={entryType}
                allNodes={allNodes}
                onSelect={onSelectNode}
                onCreate={onCreateNode}
                disabled={disabled}
              />
            </Field>
          )}
          {!isNodeReference && (
            // `gap-2` rather than the field default: this row was already spaced
            // a step wider than the fields above it.
            <Field label="Label" htmlFor={`${fieldId}-label`} className="gap-2">
              <div className="flex items-center gap-2">
                <Input
                  id={`${fieldId}-label`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={entryType === "condition" ? "Condition label" : "Junction label"}
                  aria-label={entryType === "condition" ? "Condition label" : "Junction label"}
                  disabled={disabled}
                />
                <Button type="button" size="sm" onClick={handleInsertStructured} disabled={disabled}>
                  Insert
                </Button>
              </div>
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}