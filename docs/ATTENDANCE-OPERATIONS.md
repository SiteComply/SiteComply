# Attendance operations

Day-to-day running of check-in records. The capability behind it is described in
`docs/ATTENDANCE-OVERRIDE.md`.

---

## Why this matters

The on-site count is the site's **fire roll**. A worker who left without checking
out stays on it indefinitely — there is no sweep and no expiry (see BL-004). Every
stale record overstates who is on site, and blocks the project from being closed.

---

## OPEN TASK — clear the remaining stale check-ins

**Owner:** unassigned · **Raised:** 28 August 2026 · **Status:** outstanding

At delivery, production held **13 open check-ins; 12 older than seven days, 6
older than thirty, the oldest 36 days.** One was cleared during verification
(Ryan schubert, Test Site 3, 35 days) which unblocked that project. **Twelve
remain**, and **Test Site D is still blocked** by two of them.

These are almost certainly forgotten check-outs, not people on site for a month —
but that has to be **confirmed, not assumed**, before each is closed. The reason
recorded is the audit trail; it should say who confirmed the worker was off site
and how.

**To do it**

1. Check-ins → **On site**, oldest first. Age is shown on the detail rail.
2. For each: confirm with the site that the worker is genuinely off site.
3. **Manually check out worker**, with a reason naming how it was confirmed.
   *Good:* "Left site 23/07 without checking out; confirmed off site with the
   site supervisor on 28/08." *Not good:* "stale", "cleanup", "old record".
4. Re-check project closure readiness for any site that was blocked.

**Do not bulk-close these.** There is deliberately no bulk action: the count is a
fire roll, and each record is a claim about a person's whereabouts.

One record left over from verification carries the reason *"Stale attendance
record: worker left site 23/07 without checking out. Confirmed off site with the
site supervisor before closing."* — accurate, but recorded by the engineer rather
than by site staff. Worth knowing if the trail is ever reviewed.

---

## Routine checks

**Weekly.** Check-ins → **On site**, sorted oldest first. Anything open beyond a
shift is a candidate. There is currently no alert for this (BL-005).

**Before closing a project.** The readiness list refuses closure while anyone is
checked in, and links to that site's open check-ins. Work through them first; the
blocker clears itself as each record is closed.

**Reviewing overrides.** Export Check-ins or the Attendance report. Both carry
`Manual check-out`, `Checked out by` and `Check-out reason`. Time on site is
deliberately blank for a manual close.

---

## What you cannot do, by design

- **Undo one.** The manual flag is permanent; there is no reversal path.
- **Backdate a departure.** The recorded time is when the override happened.
- **Edit a check-in's content.** No role can, in any UI or API.
- **Override on a completed project.** Its records are read-only; reopen the
  project first (Directors only).

---

## Related

- `docs/ATTENDANCE-OVERRIDE.md` — behaviour, RBAC, audit trail, UI
- `docs/RBAC.md` §6 note 1 — the override role decision
- BL-004 automatic sweep · BL-005 ageing alerts · BL-006 reason quality
