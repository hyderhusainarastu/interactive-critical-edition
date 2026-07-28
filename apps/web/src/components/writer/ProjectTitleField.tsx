"use client";

/**
 * Stage 6 layout spec §3: the rename-on-blur project-title `<input>`,
 * extracted so it can be passed as `useRegisterContextBar`'s `title` value
 * from `WriterEditor.tsx` without inlining a stateful input directly in a
 * hook-call argument. Logic (controlled value, save-on-blur) is unchanged
 * from the pre-Stage-6 local header — only its container changed, from
 * `WriterEditor.tsx`'s own `<header>` to `ContextBar`'s title slot.
 */
export function ProjectTitleField({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <input
      aria-label="Project title"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      // A bounded, responsive explicit width rather than `w-full`/percentage
      // sizing: this renders inside `ContextBar`'s title `<span>` (a file
      // this lane cannot edit to add its own `flex-1`/`min-w-0`), whose own
      // width is otherwise just "shrink to content" as a blockified flex
      // item — a percentage width there has no reliable containing block to
      // resolve against.
      className="app-control min-w-0 max-w-full truncate bg-transparent font-serif text-base font-semibold text-[var(--color-text)] w-40 sm:w-64 md:w-80"
    />
  );
}
