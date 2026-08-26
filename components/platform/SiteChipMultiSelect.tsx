'use client';

import { useRef, useState } from 'react';

/**
 * Site multi-select for the report filter bar, as chips.
 *
 * Replaces a `<details>`-collapsed list of native checkboxes. Sites are used on
 * almost every report run, so hiding them behind a disclosure cost a click every
 * time; the chips are always visible.
 *
 * PROGRESSIVE ENHANCEMENT — this is a client component, but the part that
 * matters is not. Each chip is still a real `<input type="checkbox" name="sites">`
 * with `defaultChecked`, and the selected styling is done in CSS via
 * `peer-checked:`. So with JavaScript unavailable the chips still toggle, and the
 * form still submits `?sites=…&sites=…` exactly as before. Only the two
 * conveniences degrade:
 *
 *   - All / None stop working (they need to set `checked` on the inputs)
 *   - the selected count freezes at its server-rendered value
 *
 * Both are additions to what shipped before, so nothing regresses without JS.
 * The inputs are deliberately UNCONTROLLED for this reason: making them
 * controlled would have made the chips inert without JavaScript.
 */
export function SiteChipMultiSelect({
  sites,
  selectedIds,
}: {
  sites: { id: string; name: string }[];
  /** Ids checked on first render (server-resolved). */
  selectedIds: string[];
}) {
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const [count, setCount] = useState(
    () => sites.filter((s) => selectedIds.includes(s.id)).length,
  );

  const boxes = () =>
    Array.from(
      groupRef.current?.querySelectorAll<HTMLInputElement>(
        'input[name="sites"]',
      ) ?? [],
    );

  const recount = () => setCount(boxes().filter((b) => b.checked).length);

  const setAll = (checked: boolean) => {
    for (const b of boxes()) b.checked = checked;
    recount();
  };

  return (
    <fieldset
      ref={groupRef}
      // Fires for any checkbox in the group, so one handler keeps the count
      // honest without a listener per chip.
      onChange={recount}
      className="mt-3 border-t border-line pt-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <legend className="float-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Sites
        </legend>
        {/* Announced on change so the count is not a sighted-only affordance. */}
        <span
          aria-live="polite"
          className="text-xs font-normal normal-case tracking-normal text-ink-subtle"
        >
          ({count} of {sites.length} selected)
        </span>
        {/* type="button" — these must never submit the surrounding GET form. */}
        <span className="inline-flex gap-2">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded text-xs font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded text-xs font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            None
          </button>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {sites.map((s) => (
          <label key={s.id} className="relative inline-flex">
            {/* sr-only, not hidden: it stays focusable and reachable by
                assistive tech, and `peer` drives the chip's appearance. */}
            <input
              type="checkbox"
              name="sites"
              value={s.id}
              defaultChecked={selectedIds.includes(s.id)}
              className="peer sr-only"
            />
            <span
              className={[
                // min-h-[44px] rather than the 52px `touch-target`: a comfortable
                // tap target without the chips looking like buttons.
                'inline-flex min-h-[44px] cursor-pointer select-none items-center gap-1.5',
                'rounded-full border border-line-strong bg-surface px-3.5 py-1.5',
                'text-sm font-semibold text-ink-muted transition-colors',
                'hover:border-brand-200 hover:text-ink',
                // Selected state matches SegmentedNav, so the filter reads as the
                // same family as the Check-ins and Sites status strips.
                'peer-checked:border-brand-500 peer-checked:bg-brand-500 peer-checked:text-white',
                'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500',
                // The affordance that stops an unselected chip reading as
                // disabled: + means "available", tick means "included".
                //
                // Drawn as a ::before on THIS element rather than a nested span,
                // because `peer-checked:` compiles to a general-sibling selector
                // (`.peer:checked ~ …`) and so cannot reach a descendant. A
                // nested span would simply never change.
                "before:text-xs before:font-bold before:leading-none before:content-['+']",
                "peer-checked:before:content-['✓']",
              ].join(' ')}
            >
              {s.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
