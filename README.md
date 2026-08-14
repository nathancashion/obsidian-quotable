# Share Quote

Turn a passage from your notes into a shareable image — with your book's cover art
composited in, colours pulled from that cover, and the aspect ratio you need.

Inspired by Readwise's "pretty image" highlight export, but working from whatever
is already in your vault.

## Using it

Select some text, or put the cursor inside a blockquote or callout, then trigger
**Share quote as image** from any of:

- the command palette
- the editor right-click menu (shown only when there's something to capture)
- the ribbon icon

The share sheet gives you four aspect ratios, three styles, and a row of colours
sampled from the cover art. Attribution is editable in place if the automatic
detection got it wrong.

### Aspect ratios

| Ratio | Size | Suits |
| --- | --- | --- |
| 16:9 | 1920×1080 | Presentations, X/Twitter |
| 1:1 | 1400×1400 | Feed posts |
| 4:5 | 1200×1500 | Instagram portrait |
| 9:16 | 1080×1920 | Stories, Reels |

### Styles

- **Pretty** — the cover art composited behind a colour panel, split on a diagonal.
- **Clean** — flat background, sans-serif, no cover.
- **Classic** — light background, serif, hairline rule.

### Exporting

Save to the vault, copy to the clipboard, insert an embed at the cursor, or copy
the quote as text. On mobile you also get the native share sheet. Options that
your platform can't support aren't shown — the plugin probes for them at load.

## Where the text comes from

With a selection, that's what you get. Without one, the block containing the cursor
is used: a blockquote or callout if the cursor is in one, otherwise the surrounding
paragraph.

Markdown that would otherwise show up as stray punctuation is cleaned away —
highlight markers, inline code, strikethrough, wikilinks (the display text is kept),
footnote references, list bullets, and block references.

`**Bold**`, `*italic*` and `***both***` are rendered as actual emphasis rather than
stripped. Delimiters have to sit against the text they emphasise, so a stray
asterisk (or `2 * 3`) stays literal. Underscores are not treated as emphasis,
because that would mangle `snake_case`.

## Where the attribution comes from

Checked in this order, first match wins:

1. A `<cite>` element inside the quote block
2. Frontmatter, using the keys configured in settings
3. A callout's header title
4. The note's first H1
5. The filename

A `<cite>` is split on its first comma into author and title, so a title containing
a comma or a colon survives intact:

```markdown
> Other jobs might make demands on your skills, but if you are deficient you can do
> something about it.
> <cite>Richard Dawkins, Books do Furnish a Life: An electrifying celebration of science writing</cite>
```

Frontmatter keys are configurable and matched case-insensitively. The defaults cover
Readwise exports, citation notes, and hand-written notes:

```yaml
---
author: Jodi McAlister
source: An Academic Affair
cover_image: covers/AcademicAffair.png
---
```

`cover_image` is checked ahead of generic keys like `image` and `banner`, which other
plugins and themes claim for note banners and social previews.

Covers may be a vault path, a wikilink, or a URL. Remote covers are fetched through
Obsidian's own request layer, so CORS isn't an issue.

> [!tip]
> If a remote cover looks soft, check whether the URL points at a thumbnail. Amazon
> cover URLs carry a size token — `_SY160` is only 160px tall. Raising it to
> `_SY1000` fetches a full-resolution image from the same address.

## Colours

Colours are extracted from the cover by median-cut quantisation over a downsampled
copy, weighted by saturation so a mostly-cream jacket doesn't produce four greys.
Each candidate is contrast-checked, which decides whether text is set light or dark
and darkens the background until it clears WCAG AA. Pure white and dark options are
always offered alongside.

Notes without cover art still work — you get the neutral palettes.

## Settings

- **Defaults** — aspect ratio and style the sheet opens on; whether to draw with your
  current theme's fonts instead of the style's own.
- **Export** — image scale, and which vault folder images are saved to.
- **Frontmatter** — the key lists above, comma-separated and checked in order.

## Development

```bash
npm install
npm run dev
```

`npm run dev` builds straight into a vault plugin folder and watches for changes; set
`OBSIDIAN_PLUGIN_DIR` to point it somewhere other than the default.

```bash
npm run test:capture
```

Checks for the capture, emphasis-parsing, and type-sizing logic, all of which are pure
and run without Obsidian.

There's also a rendering harness for visual review, since rendering bugs are far easier
to see than to assert:

```bash
node tools/harness-server.mjs
```

It serves `dev-harness/`, which renders the card across every ratio, style and palette
and writes full-resolution PNGs to `dev-harness/out/`. Put a cover image at
`dev-harness/fixtures/cover.png` first.

## How it renders

Cards are drawn with the Canvas 2D API rather than by rasterising DOM. Libraries in
that space wrap the DOM in an SVG `foreignObject`, which has documented blank-render
failures in iOS WKWebView — exactly what Obsidian mobile runs. Drawing directly also
means the preview *is* the export (no fidelity gap), needs no font embedding, and
makes the diagonal seam and per-ratio type fitting simpler than their CSS equivalents.

There are no runtime dependencies.

## Licence

MIT
