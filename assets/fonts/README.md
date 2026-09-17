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
