## Aphrody branch (`aphrody`)

Fork of [google/material-design-icons](https://github.com/google/material-design-icons) reduced to the
optimized Material Symbols sources: web and desktop variable fonts, one optimized SVG set per style, and a
manifest. Every legacy asset (Material Icons fonts, `png/`, `android/`, `ios/`, `src/`, multi-size and
multi-weight symbol exports) is deleted on this branch only, except the 24 px Material Icons SVGs of the 45
names that no Material Symbol, ligature alias or font glyph covers; `master` mirrors upstream and the history
is untouched. The tooling is Bun (`bun install`, `bun run`, `bun test`); there is no npm, yarn or Node step.

### Layout

| Path | Content |
| --- | --- |
| `variablefont/MaterialSymbols{Outlined,Rounded,Sharp}[FILL,GRAD,opsz,wght].woff2` | web: variable WOFF2, every axis (FILL 0..1, wght 100..700, GRAD -50..200, opsz 20..48) |
| `variablefont/MaterialSymbols{Outlined,Rounded,Sharp}[FILL,GRAD,opsz,wght].ttf` | desktop: variable TrueType, same glyphs and hinting, glyph names dropped (`post` v3) |
| `variablefont/*.codepoints` | `name hex` lines of every font ligature (upstream format) |
| `symbols/web/<name>/materialsymbols<style>/<name>_24px.svg` | optimized SVG, fill 0 |
| `symbols/web/<name>/materialsymbols<style>/<name>_fill1_24px.svg` | optimized SVG, fill 1 |
| `src/<category>/<name>/materialicons<theme>/24px.svg` | legacy Material Icons kept for the 45 uncovered names (themes `materialicons`, `…outlined`, `…round`, `…sharp`, `…twotone`), optimized in place |
| `symbols/manifest.json` | index of everything above (format below) |
| `update/current_versions.json` | Google Fonts version of every symbol (`symbols::<name>`), drives `bun run update` |

SVGs are the 24 px design at weight 400, grade 0, drawn in `viewBox="0 0 24 24"` (`width`/`height` 24),
one `<path>` each, no metadata. They are an exact affine rescale of the upstream drawing (`0 -960 960 960`,
older `0 96 960 960`, or pixel units without `viewBox`) followed by svgo at 3 decimals (4 are lossless but
save almost nothing, 2 fail the fidelity thresholds). A style directory is absent when Google does not
publish that symbol in that style. `bun run fidelity` renders 50 spread witnesses plus every legacy file at 192 px against upstream:
no pixel may change by 128 levels or more and at most 0.1 % of pixels by more than 16 levels.

### `symbols/manifest.json` (schema 1)

```jsonc
{
 "schema": 1,
 "styles": ["outlined", "rounded", "sharp"],
 "svg": { "viewBox": "0 0 24 24", "width": 24, "height": 24, "opsz": 24, "wght": 400, "grad": 0, "fill": [0, 1] },
 "fonts": {
  "outlined": {
   "family": "Material Symbols Outlined",
   "ttf": "variablefont/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].ttf",
   "woff2": "variablefont/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].woff2",
   "codepoints": "variablefont/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].codepoints",
   "sha256": { "ttf": "<hex>", "woff2": "<hex>" },
   "bytes": { "ttf": 0, "woff2": 0 },
   "glyphs": 0,
   "axes": { "FILL": { "min": 0, "default": 0, "max": 1 }, "wght": { … }, "GRAD": { … }, "opsz": { … } }
  },
  "rounded": { … }, "sharp": { … }
 },
 "count": 0,
 "symbols": {
  "home": { "codepoint": "e9b2", "svg": { "outlined": ["<fill 0 path>", "<fill 1 path>"], "rounded": […], "sharp": […] } },
  "<SVG published before the fonts>": { "codepoint": null, "svg": { … } }
 },
 "aliases": { "<font ligature without its own SVG>": "<symbol name with the same codepoint>" },
 "fontOnly": { "<font ligature drawn by no SVG>": "<codepoint>" },
 "legacy": { "facebook": { "materialicons": "src/…/facebook/materialicons/24px.svg", "materialiconsoutlined": "…" } }
}
```

- Paths are relative to the repository root; `codepoint` is lowercase hex, the glyph is the character
  `U+<codepoint>` in the Private Use Area (the same in the three fonts).
- Keys are sorted; each line of the file holds one entry, so updates diff well. Every font ligature is
  exactly one of: a `symbols` entry, an `aliases` entry or a `fontOnly` entry (`bun test` checks it).
- Resolving `symbol:<name>`, in order:
  1. `symbols[name]`, else `symbols[aliases[name]]`: SVG = `svg[style][fill]` (default style `outlined`,
     fill 0; fall back to the first style present); font glyph = `U+<codepoint>` (or the ligature `name`)
     in `fonts[style].ttf` (desktop) or `.woff2` (web), with the variation axes of `fonts[style].axes`.
     `codepoint` is `null` for an SVG Google published before the fonts: SVG only.
  2. `fontOnly[name]`: font glyph `U+<codepoint>` only, no SVG.
  3. `legacy[name]`: Material Icons SVG only (theme `materialicons` = filled, `materialiconsoutlined` =
     outlined, `materialiconsround` = rounded, `materialiconssharp` = sharp), not in the fonts nor on the CDN.
  `bun run manifest` fails when an update makes the Symbols cover a legacy name: delete its `src/` files.

### CDN (`cdn.aphrody.com`)

`bun run cdn build` writes `dist/cdn/` (`h/`, `s/symbols/`); `bun run cdn publish --host dbfr` uploads it to
`/home/ubuntu/apps/cdn/symbols/releases/<id>` and switches `/home/ubuntu/apps/cdn/symbols/current`, a static
root of `aphrody-fonts-proxy` (aphrody repository, `tools/config/asset-catalog.json` `releases`);
`bun run cdn verify` checks every URL (200, content type, CORS `*`, immutable cache on hashed files).

- `https://cdn.aphrody.com/s/symbols/material-symbols.css`: stable URL, short cache. `@font-face` per
  style (variable WOFF2, `font-display: block`) and the Google classes `.material-symbols-outlined`,
  `.material-symbols-rounded`, `.material-symbols-sharp` (FILL/GRAD through `--material-symbols-fill` and
  `--material-symbols-grad`).
- `https://cdn.aphrody.com/h/<sha256[0..16]>.{css,woff2,ttf}`: content-addressed, `immutable`, one year.
- `https://cdn.aphrody.com/s/symbols/release.json`: commit, URLs, sizes and sha256 of the current release.

### Commands

```sh
bun install
bun run update            # new/changed symbols and fonts from Google Fonts, then build
bun run build             # fonts (TTF + WOFF2 + codepoints), SVG optimization, manifest
bun run check             # fails if any SVG, the manifest or a font is not in optimized form
bun run subset --text "home search settings" [--styles outlined] [--axes "FILL=0:1 wght=400"]
bun run fidelity          # renders 50 witness + every legacy SVG, optimized vs origin/master, with resvg
bun test && bun run typecheck && bun run lint && bun run format:check
```

Font work (WOFF2 Brotli encode/decode, subsetting, instancing) runs fontTools through `uvx` at a pinned
version (`scripts/lib/fonttools.ts`): it is the reference implementation of these formats, with no Bun or
Rust tool of equivalent output and verification today, and no Python file is tracked. Everything else
(fetching, cmap/GSUB parsing, SVG rewriting, manifest, CDN release) is TypeScript run by Bun.

### Upstream sync

`master` fast-forwards to `upstream/master`. `aphrody` takes upstream changes from their source, Google
Fonts, with `bun run update` (the same metadata and endpoints as upstream `update_symbols.py`), then
commits; a merge of `master` is never needed. The history of both branches is never rewritten.

---

## Material Symbols / Material Icons

These are two different official icon sets from Google, using the same underlying designs. Material Symbols is the current set, introduced in April 2022, built on variable font technology. Material Icons is the classic set, but no longer updated. More details below.

The icons can be browsed in a more user-friendly way at https://fonts.google.com/icons. Use the popdown menu near top left to choose between the two sets; Material Symbols is the default.

The icons are designed under the [material design guidelines](https://material.io/guidelines/).

## Icon Requests

We’d love to support your icon needs! Please submit your request here on GitHub as an issue.

Please note that Google Fonts does not accept user submissions of finished icon designs! There are fairly strict  guidelines for Material icons, plus Google has upstream source files from which this repo is generated. Therefore, Google does not accept pull requests for icon files (whether new icon suggestions, or fixes for existing icons). Concepts are appreciated—just don’t design SVGs and submit them via pull request.

However, users are perfectly welcome to point at outside files or images as examples—for the kind of thing they want, but they won’t just be taken “as is.” This works especially well if you have multiple examples for a single icon, to help us understand the “essence” of the idea.

> For example, there is a fairly universal conceptual logo/icon for “agender,” so if you were proposing Google add an agender icon in the Material style, either mentioning that, or pointing at https://www.google.com/search?q=agender+icon would be a helpful tip.

### Third-party logos

Currently, Google does not include 3rd-party logos among the Material Symbols or Material Icons due to legal reasons. Some 3rd-party logos that were included in the past have since been removed.

## npm Packages

Google does not currently maintain the npm package for this repo, past v3 (2016). However, user @marella is hosting the following. He tells us these are automatically updated and published using GitHub Actions. Note: Google does **not** monitor or vet these packages.

### [material-symbols](https://github.com/marella/material-symbols/tree/main/material-symbols#readme) [![npm](https://img.shields.io/npm/v/material-symbols)](https://www.npmjs.com/package/material-symbols) [![install size](https://packagephobia.com/badge?p=material-symbols)](https://packagephobia.com/result?p=material-symbols)

- Only WOFF2 variable fonts and CSS for Material Symbols
- Includes outlined, rounded, and sharp icons and all variations of fill, weight, grade, and optical size
- Supports Sass

### [material-icons](https://github.com/marella/material-icons#readme) [![npm](https://img.shields.io/npm/v/material-icons)](https://www.npmjs.com/package/material-icons) [![install size](https://packagephobia.com/badge?p=material-icons)](https://packagephobia.com/result?p=material-icons) [![Downloads](https://img.shields.io/npm/dm/material-icons)](https://www.npmjs.com/package/material-icons)

- Only WOFF2, WOFF fonts and CSS
- Includes outlined, round, sharp and two-tone icons
- Supports Sass

### [@material-design-icons/font](https://github.com/marella/material-design-icons/tree/main/font#readme) [![npm (scoped)](https://img.shields.io/npm/v/@material-design-icons/font)](https://www.npmjs.com/package/@material-design-icons/font) [![install size](https://packagephobia.com/badge?p=@material-design-icons/font)](https://packagephobia.com/result?p=@material-design-icons/font)

- Only WOFF2 fonts and CSS
- Lighter version of `material-icons` package
- Doesn't support [older browsers](https://caniuse.com/woff2) such as Internet Explorer because of dropping WOFF (v1)

### [@material-design-icons/svg](https://github.com/marella/material-design-icons/tree/main/svg#readme) [![npm (scoped)](https://img.shields.io/npm/v/@material-design-icons/svg)](https://www.npmjs.com/package/@material-design-icons/svg) [![install size](https://packagephobia.com/badge?p=@material-design-icons/svg)](https://packagephobia.com/result?p=@material-design-icons/svg)

- Only SVGs
- Optimizes SVGs using SVGO

## Material Symbols

These newer icons can be browsed in a more user-friendly way at https://fonts.google.com/icons. Use the popdown menu near top left to choose between the two sets; Material Symbols is the default.

These icons were built/designed as variable fonts first (based on the 24 px designs from Material Icons). There are three separate Material Symbols variable fonts, which also have static icons available (but those do not have all the variations available, as that would be hundreds of styles):
- Outlined
- Rounded
- Sharp
- Note that although there is no separate Filled font, the Fill axis allows access to filled styles, in all three fonts. It can also be manipulated for an animated fill effect, to indicate user selection.

Each of the fonts has these design axes, which can be varied in CSS, or in many more modern design apps:
- Optical Size (opsz) from 20 to 48 px. The default is 24.
- Weight from 100 (Thin) to 700 (Bold). Regular is 400.
- Grade from -50 to 200. The default is 0 (zero). -50 is suggested for reversed contrast (e.g. white icons on black background)
- Fill from 0 to 100. The default is 0 (zero).

The following directories in this repo contain specifically Material Symbols (not Material Icons) content:
- symbols
- variablefont

What is currently _not_ available in Material Symbols?
- only the 20 and 24 px versions are designed with perfect pixel-grid alignment
- the only pre-made fonts are the variable fonts
- there are no two-tone icons

## Material Icons

The icons can be browsed in a more user-friendly way at https://fonts.google.com/icons?icon.set=Material+Icons

These classic icons are available in five distinct styles:
- Outlined
- Filled (the font version is just called Material Icons, as this is the oldest style)
- Rounded
- Sharp
- Two tone

The following directories in this repo contain specifically Material Icons (not Material Symbols) content:
- android
- font
- ios
- png
- src

What is currently _not_ available in Material Icons?
- variable fonts
- weights other than Regular
- grades other than Regular
- a means to animate Fill transitions
- new icons (since updates were halted in 2022)

## Material Icons update history

### 4.0.0 Update
* 2020 Aug 31
* Restructured repository, updated assets.

### 3.0.1 Update
* 2016 Sep 01
* Changed license in package.json.
* Added missing device symbol sprites.

### 3.0.0 Update
* 2016 Aug 25
* License change to Apache 2.0!

### 2.0
* 2016 May 28

## Getting Started

Read the [developer guide](https://developers.google.com/fonts/docs/material_icons) on how to use the material design icons in your project.

### Using a font

The `font` and `variablefont` folders contain pre-generated font files that can be included in a project. This is especially convenient for the web; however, it is generally better to link to the web font hosted on Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Icons"
      rel="stylesheet">
```

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"
      rel="stylesheet">
```
Read more on [Material Symbols](https://developers.google.com/fonts/docs/material_symbols/) or [Material Icons](https://developers.google.com/fonts/docs/material_icons/) in the Google Fonts developer guide.


## License

We have made these icons available for you to incorporate into your products under the [Apache License Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt). Feel free to remix and re-share these icons and documentation in your products.
We'd love attribution in your app's *about* screen, but it's not required.
