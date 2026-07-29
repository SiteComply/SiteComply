'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  TEMPLATE_NAME_MAX,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_ITEM_LABEL_MAX,
  TEMPLATE_MAX_ITEMS,
} from '@/services/audits/auditTemplateConstants';
import { FINDING_CATEGORIES } from '@/services/audits/findingConstants';
import { FINDING_SEVERITIES } from '@/services/audits/findingConstants';

interface ItemRow {
  label: string;
  helpText: string;
  category: string;
  defaultSeverity: string;
}

/** Create / edit an audit template (SC-013) — name, description and its items. */
export function AuditTemplateForm({
  mode,
  templateId,
  initial,
}: {
  mode: 'create' | 'edit';
  templateId?: string;
  initial?: {
    name: string;
    description: string;
    items: ItemRow[];
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [items, setItems] = useState<ItemRow[]>(
    initial?.items?.length
      ? initial.items
      : [{ label: '', helpText: '', category: 'OTHER', defaultSeverity: '' }],
  );
  const [busy, setBusy] = useState(false);

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }
  function addItem() {
    if (items.length >= TEMPLATE_MAX_ITEMS) return;
    setItems((rows) => [
      ...rows,
      { label: '', helpText: '', category: 'OTHER', defaultSeverity: '' },
    ]);
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }

  const validItems = items.filter((r) => r.label.trim().length > 0);

  async function save() {
    if (name.trim().length < 2) {
      toast.error('A template name is required.');
      return;
    }
    if (validItems.length === 0) {
      toast.error('Add at least one checklist item.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        mode === 'create'
          ? '/api/platform/audit-templates'
          : `/api/platform/audit-templates/${templateId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description,
            items: validItems.map((r) => ({
              label: r.label,
              helpText: r.helpText,
              category: r.category,
              defaultSeverity: r.defaultSeverity || null,
            })),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save the template.');
        return;
      }
      toast.success(
        mode === 'create' ? 'Template created.' : 'Template updated.',
      );
      router.push('/platform/dashboard/audits/templates');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <TextField
        label="Template name"
        value={name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Monthly Fire Safety Audit"
      />
      <Textarea
        label="Description (optional)"
        rows={2}
        maxLength={TEMPLATE_DESCRIPTION_MAX}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="What this audit format covers."
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold text-ink">
            Checklist items
          </label>
          <span className="text-xs text-ink-subtle">
            {validItems.length}/{TEMPLATE_MAX_ITEMS}
          </span>
        </div>
        <div className="space-y-3">
          {items.map((row, i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-surface p-3"
            >
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={row.label}
                  maxLength={TEMPLATE_ITEM_LABEL_MAX}
                  onChange={(e) => setItem(i, { label: e.target.value })}
                  placeholder="Thing to inspect…"
                  className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="shrink-0 rounded-lg px-2 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50"
                  aria-label="Remove item"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={row.category}
                  onChange={(e) => setItem(i, { category: e.target.value })}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {FINDING_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={row.defaultSeverity}
                  onChange={(e) =>
                    setItem(i, { defaultSeverity: e.target.value })
                  }
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Default severity…</option>
                  {FINDING_SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addItem}
          disabled={items.length >= TEMPLATE_MAX_ITEMS}
          className={cn(
            'mt-3 rounded-lg border border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50',
            items.length >= TEMPLATE_MAX_ITEMS && 'opacity-50',
          )}
        >
          + Add item
        </button>
      </div>

      <div className="flex gap-3">
        <Button variant="brand" onClick={save} disabled={busy}>
          {busy
            ? 'Saving…'
            : mode === 'create'
              ? 'Create template'
              : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
