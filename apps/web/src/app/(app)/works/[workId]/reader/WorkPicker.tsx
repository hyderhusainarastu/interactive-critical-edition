"use client";

import { useEffect, useState } from "react";

interface WorkOption {
  workId: string;
  title: string;
  authorName: string | null;
}

export function WorkPicker({
  currentWorkId,
  active,
  onSelect,
  onClear,
}: {
  currentWorkId: string;
  active: boolean;
  onSelect: (workId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<WorkOption[] | null>(null);

  useEffect(() => {
    if (!open || options) return;
    fetch("/api/works")
      .then((r) => r.json())
      .then((rows: WorkOption[]) => setOptions(rows.filter((w) => w.workId !== currentWorkId)));
  }, [open, options, currentWorkId]);

  if (active) {
    return (
      <button type="button" onClick={onClear}>
        Exit split view
      </button>
    );
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}>
        Split view
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md">
          {!options && <p className="px-2 py-1.5 text-[var(--color-text-muted)]">Loading…</p>}
          {options?.length === 0 && (
            <p className="px-2 py-1.5 text-[var(--color-text-muted)]">No other works ready yet.</p>
          )}
          {options?.map((w) => (
            <button
              key={w.workId}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-background)]"
              onClick={() => {
                onSelect(w.workId);
                setOpen(false);
              }}
            >
              {w.title}
              {w.authorName && <span className="text-[var(--color-text-muted)]"> — {w.authorName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
