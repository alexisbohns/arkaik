"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface NewNodeFormProps {
  onSubmit?: (title: string) => void;
}

export function NewNodeForm({ onSubmit }: NewNodeFormProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem("title") as HTMLInputElement).value;
    onSubmit?.(title);
    form.reset();
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input name="title" placeholder="Node title" required />
      <Button type="submit">Add</Button>
    </form>
  );
}
