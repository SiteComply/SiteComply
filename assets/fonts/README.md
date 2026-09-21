# Bundled fonts

`SourceSans3-*.woff` — Source Sans 3, SIL Open Font License 1.1.
Taken from the `@fontsource/source-sans-3` package (latin subset).

These are embedded into the **induction record PDF** by
`services/inductionRecord/InductionRecordPdf.tsx`.

## Why the files are committed rather than resolved from node_modules

The PDF must look identical to everyone who opens it — that is the whole reason
the record is generated server-side instead of printed from a browser. Reading
the faces from a transitive dependency would make the document's appearance a
function of the install tree. Four small files (84 KB total) removes that.

## Why WOFF and not TTF

`@react-pdf` embeds these fine, and `@fontsource` ships no TTF for this family.
Verified by rendering, not assumed.

## The italic face is required, not decorative

`@react-pdf` resolves a font by (family, weight, style) and **throws** when the
combination is missing — it does not synthesise an oblique the way a browser
does. The declaration is set in italic, so removing `SourceSans3-400-italic.woff`
breaks every induction record with a 500.

---

`Chivo-*.woff`, `CrimsonPro-*.woff` — Chivo and Crimson Pro, SIL Open Font
License 1.1, from Google Fonts (`ofl/chivo`, `ofl/crimsonpro`).

These are embedded into the **Construction Phase Plan PDF** by
`services/sites/cppPdf/CppPdfDocument.tsx`. They are the same two families the
CPP screen document loads through `next/font`, so the controlled PDF and the
on-screen plan share one type identity.

## Why these are not taken from the `next/font` output

`next/font` emits hashed, subsetted `.woff2` into `.next/static/media` — the
filenames change on every build, and the latin subset it ships carries ~300
glyphs. These files carry ~780, which matters for real site and operative
names: accented and Welsh characters appear in both.

## Why WOFF and not WOFF2 — this one bites

`fontkit` READS woff2 quite happily, so a woff2 file looks like it works right
up until the document is written. It is `pdfkit` that cannot EMBED it: woff2
stores a transformed `glyf` table that is not reconstructable for re-encoding,
and the render dies inside `EmbeddedFont.embed` with a fontkit stack trace that
says nothing about woff2. Verified by rendering both, not assumed.

## Weights

Chivo 400/600/700 and Crimson Pro 400/600 are registered because the document
uses exactly those five. No italic face is registered for either family, and
nothing in the CPP is set in italic — per the note above, adding an italic style
to the document without adding the face would throw rather than degrade.
