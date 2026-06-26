# UK Localisation & Compliance — review checklist

A checklist-style confirmation that SiteComply meets the UK localisation and data
protection requirements. Each item notes where it is implemented.

## Language

- [x] **British English spelling** throughout UI text and code comments
      (organisation, colour, fulfil, acknowledgement, licence, centre,
      behaviour, programme). Verified by a source sweep — the only American
      spellings are unavoidable platform tokens: the HTML `autocomplete="organization"`
      value, CSS property names (`scroll-behavior`, `tap-highlight-color`) and
      Tailwind utilities (`items-center`). No prose/comment Americanisms.

## Dates & times

- [x] **Dates display as `DD/MM/YYYY`** — all formatting via `formatDateUK`
      (`lib/datetime.ts`); no direct `toLocale*`/`Intl` calls anywhere else.
- [x] **Times display in 24-hour `HH:mm`** — `formatTimeUK`.
- [x] **Stored as ISO 8601 / UTC** — Prisma `DateTime`; formatting only at the edge.
- [x] **Europe/London with correct GMT/BST** — single timezone in `lib/config.ts`;
      date-range filtering uses `zonedMidnightToUtc` (unit-checked: 14/06 BST →
      13/06 23:00Z, 15/01 GMT → 00:00Z). Verified live: a 06:50 UTC check-in
      displays as 07:50 (BST).

## Phone numbers

- [x] **UK mobile validation** — accepts `07xxx xxxxxx`, `+44…`, `44…`, `0044…`
      with spacing/punctuation (`lib/phone.ts`).
- [x] **Normalised to E.164 `+44…`** for SMS sending and storage; display/mask
      helpers for UI.

## Address / postcode

- [x] **UK postcode validation & normalisation** (`lib/postcode.ts`, used by the
      site service) — `m1 1ae` → `M1 1AE`; invalid rejected with a field error.

## UK construction terminology

- [x] **CSCS card** (number/type/expiry captured; UK card-colour labels).
- [x] **RAMS**, **CDM 2015**, **HSE**, **toolbox talk**, **near miss**,
      **permit to work**, **fire assembly point**, **first aider**,
      **welfare facilities**, **site induction** — present in the induction
      template, wizard, seed data and copy.
- [x] **PPE** items: hard hat, hi-vis vest, safety boots, eye protection,
      gloves, ear defenders.

## Currency

- [x] Not shown anywhere in v1 (no monetary values). GBP `£` to be used if added.

## Data protection (UK GDPR / DPA 2018)

- [x] **Consent capture** — explicit UK GDPR consent step in the worker
      induction; stored on the submission (`gdprConsent`).
- [x] **Privacy notice** — full notice at `/privacy`, linked from the app footer
      and the induction consent step.
- [x] **Data minimisation** — only name, company, mobile, optional CSCS and the
      induction answers are stored.
- [x] **Right to erasure** — admins can erase a worker's personal data from the
      submission detail view (`/api/admin/workers/[id]/erase`); identifiers are
      anonymised while the anonymised compliance record is retained for H&S /
      CDM 2015 record-keeping. OTP challenges for the number are also cleared.
