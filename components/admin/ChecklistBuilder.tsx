'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

export type BuilderItemType = 'ACKNOWLEDGEMENT' | 'YES_NO' | 'PPE_CONFIRM';

export interface BuilderItemData {
  label: string;
  helpText: string;
  type: BuilderItemType;
  required: boolean;
}

interface BuilderItem extends BuilderItemData {
  key: number;
}

const TYPE_LABELS: Record<BuilderItemType, string> = {
  ACKNOWLEDGEMENT: 'Acknowledgement',
  YES_NO: 'Yes / No question',
  PPE_CONFIRM: 'PPE confirmation',
};

/**
 * Per-site induction checklist builder. Add, edit, reorder (move up/down),
 * delete and mark items required. "Load UK template" seeds the standard UK
 * induction. Saving versions the checklist when needed (handled server-side).
 */
export function ChecklistBuilder({
  siteId,
  currentVersion,
  hasSubmissions,
  initialItems,
  template,
}: {
  siteId: string;
  currentVersion: number;
  hasSubmissions: boolean;
  initialItems: BuilderItemData[];
  template: BuilderItemData[];
}) {
  const router = useRouter();
  const toast = useToast();
  const keyRef = useRef(0);
  const withKeys = (data: BuilderItemData[]): BuilderItem[] =>
    data.map((d) => ({ ...d, key: keyRef.current++ }));

  const [items, setItems] = useState<BuilderItem[]>(withKeys(initialItems));
  const [busy, setBusy] = useState(false);

  function update(key: number, patch: Partial<BuilderItemData>) {
    setItems((list) =>
      list.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
  }
  function move(index: number, delta: number) {
    setItems((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function remove(key: number) {
    setItems((list) => list.filter((it) => it.key !== key));
  }
  function add() {
    setItems((list) => [
      ...list,
      {
        key: keyRef.current++,
        label: '',
        helpText: '',
        type: 'ACKNOWLEDGEMENT',
        required: true,
      },
    ]);
  }
  function loadTemplate() {
    if (
      items.length > 0 &&
      !window.confirm('Replace the current items with the UK template?')
    ) {
      return;
    }
    setItems(withKeys(template));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({
            label: it.label,
            helpText: it.helpText,
            type: it.type,
            required: it.required,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save. Please try again.');
        return;
      }
      toast.success(
        data.newVersion
          ? `Saved as version ${data.version}. Existing check-ins keep their original version.`
          : `Saved (version ${data.version}).`,
      );
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted">
          Current version <strong className="text-ink">{currentVersion}</strong>
          {hasSubmissions && (
            <>
              {' '}
              · saving will{' '}
              <strong className="text-ink">create a new version</strong> (this
              one has check-ins).
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={loadTemplate}
          >
            Load UK template
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={add}>
            Add item
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-ink-muted">
          No items yet. Add one, or load the UK template to get started.
        </p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li
              key={item.key}
              className="rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-subtle">
                  Item {index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <IconBtn
                    label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn
                    label="Delete"
                    onClick={() => remove(item.key)}
                    danger
                  >
                    ✕
                  </IconBtn>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  aria-label={`Item ${index + 1} label`}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink"
                  placeholder="Statement or question shown to the worker"
                  value={item.label}
                  onChange={(e) => update(item.key, { label: e.target.value })}
                />
                <input
                  aria-label={`Item ${index + 1} help text`}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  placeholder="Helper text (optional)"
                  value={item.helpText}
                  onChange={(e) =>
                    update(item.key, { helpText: e.target.value })
                  }
                />
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label={`Item ${index + 1} type`}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                    value={item.type}
                    onChange={(e) =>
                      update(item.key, {
                        type: e.target.value as BuilderItemType,
                      })
                    }
                  >
                    {(Object.keys(TYPE_LABELS) as BuilderItemType[]).map(
                      (t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ),
                    )}
                  </select>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="h-5 w-5 rounded border-line"
                      checked={item.required}
                      onChange={(e) =>
                        update(item.key, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="sticky bottom-0 flex gap-3 bg-surface-sunken py-3">
        <Button type="button" size="lg" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save checklist'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => router.push('/admin/sites')}
          disabled={busy}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border text-base disabled:opacity-30',
        danger
          ? 'border-danger-500/40 text-danger-600 hover:bg-danger-50'
          : 'border-line text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}
