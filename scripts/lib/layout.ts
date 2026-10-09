// SPDX-License-Identifier: Apache-2.0
// Repository layout of the `aphrody` branch, shared by every script.
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../..");
export const STYLES = ["outlined", "rounded", "sharp"] as const;
export type Style = (typeof STYLES)[number];
export const FILLS = [false, true] as const;

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
/** Google family name, e.g. `Material Symbols Outlined`. */
export const family = (style: Style) => `Material Symbols ${cap(style)}`;
/** Upstream style directory, e.g. `materialsymbolsoutlined`. */
export const styleDir = (style: Style) => `materialsymbols${style}`;
/** Font base name without extension, e.g. `MaterialSymbolsOutlined[FILL,GRAD,opsz,wght]`. */
export const fontBase = (style: Style) => `MaterialSymbols${cap(style)}[FILL,GRAD,opsz,wght]`;
export const fontPath = (style: Style, ext: "ttf" | "woff2" | "codepoints") =>
  `variablefont/${fontBase(style)}.${ext}`;
/** Optimized 24 px SVG, weight 400, grade 0, fill 0 or 1 (upstream file names). */
export const svgPath = (name: string, style: Style, fill: boolean) =>
  `symbols/web/${name}/${styleDir(style)}/${name}${fill ? "_fill1" : ""}_24px.svg`;
export const SVG_GLOB = "symbols/web/*/materialsymbols*/*_24px.svg";
/** Legacy Material Icons themes; kept only for names the Symbols lack, at their upstream path. */
export const LEGACY_THEMES = [
  "materialicons",
  "materialiconsoutlined",
  "materialiconsround",
  "materialiconssharp",
  "materialiconstwotone",
] as const;
export type LegacyTheme = (typeof LEGACY_THEMES)[number];
export const legacyPath = (category: string, name: string, theme: LegacyTheme) =>
  `src/${category}/${name}/${theme}/24px.svg`;
export const LEGACY_GLOB = "src/*/*/materialicons*/24px.svg";
export const MANIFEST = "symbols/manifest.json";
export const VERSIONS = "update/current_versions.json";

export const abs = (rel: string) => join(ROOT, rel);
