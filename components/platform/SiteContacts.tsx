'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
  CONTACT_ROLE_MAX,
} from '@/services/sites/siteContactConstants';

export interface SiteContactRow {
  id: string;
  role: string;
  name: string | null;
  phone: string | null;
}

/**
 * Site contacts manager (SC-003). Maintains the list of people and numbers shown
 * on the Worker Dashboard's Site Contacts panel. Writes go through
 * /api/platform/sites/[id]/contacts and /api/platform/site-contacts/[contactId],
 * then refresh the server component so the list re-renders from the database.
 */
export function SiteContacts({
  siteId,
  contacts,
  canEdit,
}: {
  siteId: string;
  contacts: SiteContactRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function reset() {
    setRole('');
    setName('');
    setPhone('');
    setErrors({});
  }

  async function add() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, name, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else toast.error(data.error ?? 'Could not add the contact.');
        return;
      }
      toast.success('Contact added.');
      reset();
      setShowForm(false);
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRowBusy(id);
    try {
      const res = await fetch(`/api/platform/site-contacts/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not remove the contact.');
        return;
      }
      toast.success('Contact removed.');
      setDeleteId(null);
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {contacts.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No contacts added. Workers will see an empty Site Contacts panel.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  {c.role}
                </p>
                {c.name && (
                  <p className="text-sm font-semibold text-ink">{c.name}</p>
                )}
                {c.phone && <p className="text-sm text-ink-muted">{c.phone}</p>}
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="shrink-0 text-sm font-semibold text-danger-600 hover:underline disabled:opacity-50"
                  disabled={rowBusy === c.id}
                  onClick={() => setDeleteId(c.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit &&
        (showForm ? (
          <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
            <TextField
              label="Role"
              maxLength={CONTACT_ROLE_MAX}
              placeholder="e.g. Site Manager"
              value={role}
              error={errors.role}
              onChange={(e) => setRole(e.target.value)}
            />
            <TextField
              label="Name (optional)"
              maxLength={CONTACT_NAME_MAX}
              placeholder="e.g. Michael Johnson"
              value={name}
              error={errors.name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Contact number (optional)"
              type="tel"
              maxLength={CONTACT_PHONE_MAX}
              placeholder="e.g. 07812 345678"
              value={phone}
              error={errors.phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={add} disabled={busy}>
                {busy ? 'Adding…' : 'Add contact'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  reset();
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="touch-target inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
            onClick={() => setShowForm(true)}
          >
            <span aria-hidden="true">＋</span> Add contact
          </button>
        ))}

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove this contact?"
        message="Workers will no longer see this contact on their dashboard."
        confirmLabel={rowBusy ? 'Removing…' : 'Remove'}
        cancelLabel="Cancel"
        busy={rowBusy !== null}
        onConfirm={() => deleteId && remove(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
