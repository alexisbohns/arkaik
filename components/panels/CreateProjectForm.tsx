"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CreateProjectFormData {
  title: string;
  description?: string;
}

interface CreateProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateProjectFormData) => Promise<void> | void;
}

export function CreateProjectForm({ open, onOpenChange, onSubmit }: CreateProjectFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setTitle("");
    setDescription("");
    setSubmitting(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      handleOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Start a new empty project.</DialogDescription>
        </DialogHeader>

        <form id="create-project-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
              required
              aria-label="Project title"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              aria-label="Project description"
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-project-form" disabled={submitting || !title.trim()}>
            {submitting ? "Creating..." : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
