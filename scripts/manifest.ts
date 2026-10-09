#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// symbols/manifest.json: every symbol name -> codepoint and its optimized SVG per style, the fonts and the
// font-only ligature aliases. The single index read by the Rust `symbol:<name>` loader.
// Usage: bun scripts/manifest.ts [--check]
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import {
  LEGACY_GLOB,
  LEGACY_THEMES,
  MANIFEST,
  ROOT,
  STYLES,
  abs,
  family,
  fontPath,
  svgPath,
  type LegacyTheme,
  type Style,
} from "./lib/layout.ts";
import { axes, glyphCount } from "./lib/sfnt.ts";

export interface SymbolEntry {
  /**
   * Lowercase hex codepoint of the ligature glyph, as in the `.codepoints` files; `null` when the fonts
   * do not carry the symbol yet (Google publishes some SVGs before the fonts): SVG only.
   */
  codepoint: string | null;
  /** Per style: [fill 0, fill 1] SVG paths relative to the repository root. */
  svg: Partial<Record<Style, [string, string]>>;
}

export interface Manifest {
  schema: 1;
  styles: Style[];
  svg: {
    viewBox: string;
    width: number;
    height: number;
    opsz: number;
    wght: number;
    grad: number;
    fill: [0, 1];
  };
  fonts: Record<
    Style,
    {
      family: string;
      ttf: string;
      woff2: string;
      codepoints: string;
      sha256: { ttf: string; woff2: string };
      bytes: { ttf: number; woff2: number };
      glyphs: number;
      axes: Record<string, { min: number; default: number; max: number }>;
    }
  >;
  count: number;
  symbols: Record<string, SymbolEntry>;
  /** Font ligature names without their own SVG -> the symbol drawn with the same codepoint. */
  aliases: Record<string, string>;
  /** Font ligatures drawn by no SVG at all -> codepoint: font glyph only. */
  fontOnly: Record<string, string>;
  /** Legacy Material Icons names the Symbols do not cover at all: 24 px SVG per legacy theme. */
  legacy: Record<string, Partial<Record<LegacyTheme, string>>>;
}

export function parseCodepoints(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [name, cp] = line.split(" ") as [string, string];
    map.set(name, cp);
  }
  return map;
}

const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");

export async function buildManifest(): Promise<Manifest> {
  const fonts = {} as Manifest["fonts"];
  const codepoints = new Map<Style, Map<string, string>>();
  for (const style of STYLES) {
    const ttf = abs(fontPath(style, "ttf"));
    const woff2 = abs(fontPath(style, "woff2"));
    const bytes = new Uint8Array(await Bun.file(ttf).arrayBuffer());
    codepoints.set(
      style,
      parseCodepoints(await Bun.file(abs(fontPath(style, "codepoints"))).text()),
    );
    fonts[style] = {
      family: family(style),
      ttf: fontPath(style, "ttf"),
      woff2: fontPath(style, "woff2"),
      codepoints: fontPath(style, "codepoints"),
      sha256: { ttf: await sha256(ttf), woff2: await sha256(woff2) },
      bytes: { ttf: Bun.file(ttf).size, woff2: Bun.file(woff2).size },
      glyphs: glyphCount(bytes),
      axes: Object.fromEntries(
        axes(bytes).map((a) => [a.tag, { min: a.min, default: a.def, max: a.max }]),
      ),
    };
  }
  const names = (await readdir(abs("symbols/web"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const symbols: Record<string, SymbolEntry> = {};
  const byCodepoint = new Map<string, string>();
  for (const name of names) {
    const svg: SymbolEntry["svg"] = {};
    let codepoint: string | undefined;
    for (const style of STYLES) {
      const pair: [string, string] = [svgPath(name, style, false), svgPath(name, style, true)];
      if (pair.every((p) => existsSync(abs(p)))) svg[style] = pair;
      const cp = codepoints.get(style)!.get(name);
      if (cp && codepoint && cp !== codepoint)
        throw new Error(`${name}: codepoint differs between styles`);
      codepoint ??= cp;
    }
    if (!Object.keys(svg).length) throw new Error(`${name}: no complete SVG pair`);
    symbols[name] = { codepoint: codepoint ?? null, svg };
    if (codepoint && !byCodepoint.has(codepoint)) byCodepoint.set(codepoint, name);
  }
  const aliases: Record<string, string> = {};
  const fontOnly: Record<string, string> = {};
  const ligatures = new Map<string, string>();
  for (const style of STYLES) for (const [n, cp] of codepoints.get(style)!) ligatures.set(n, cp);
  for (const [name, cp] of [...ligatures].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (symbols[name]) continue;
    const target = byCodepoint.get(cp);
    if (target) aliases[name] = target;
    else fontOnly[name] = cp;
  }
  const legacy: Manifest["legacy"] = {};
  const legacyFiles = await Array.fromAsync(
    new Bun.Glob(LEGACY_GLOB).scan({ cwd: ROOT, onlyFiles: true }),
  );
  for (const rel of legacyFiles.map((f) => f.replaceAll("\\", "/")).sort()) {
    const [, , name, theme] = rel.split("/") as [string, string, string, LegacyTheme];
    if (!LEGACY_THEMES.includes(theme)) throw new Error(`${rel}: unknown legacy theme`);
    if (symbols[name] || aliases[name] || fontOnly[name])
      throw new Error(`${rel}: the Symbols now cover ${name}, delete its legacy files`);
    (legacy[name] ??= {})[theme] = rel;
  }
  return {
    schema: 1,
    styles: [...STYLES],
    svg: {
      viewBox: "0 0 24 24",
      width: 24,
      height: 24,
      opsz: 24,
      wght: 400,
      grad: 0,
      fill: [0, 1],
    },
    fonts,
    count: names.length,
    symbols,
    aliases,
    fontOnly,
    legacy,
  };
}

/** Pretty top level, one compact line per entry: small and diff-friendly. */
export function manifestText(m: Manifest): string {
  const block = (key: string, o: Record<string, unknown>) =>
    `\n ${JSON.stringify(key)}: {\n${Object.entries(o)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(",\n")}\n }`;
  const { symbols, aliases, fontOnly, legacy, ...head } = m;
  const top = JSON.stringify(head, null, 1).slice(0, -2);
  return `${top},${block("symbols", symbols)},${block("aliases", aliases)},${block("fontOnly", fontOnly)},${block("legacy", legacy)}\n}\n`;
}

if (import.meta.main) {
  const text = manifestText(await buildManifest());
  const file = Bun.file(abs(MANIFEST));
  if (process.argv.includes("--check")) {
    const same = (await file.exists()) && (await file.text()) === text;
    console.log(`manifest: ${same ? "up to date" : "stale"}`);
    process.exit(same ? 0 : 1);
  }
  await Bun.write(file, text);
  const m = JSON.parse(text) as Manifest;
  console.log(
    `manifest: ${m.count} symbols (${Object.values(m.symbols).filter((s) => !s.codepoint).length} SVG only), ${Object.keys(m.aliases).length} aliases, ${Object.keys(m.fontOnly).length} font only, ${Object.keys(m.legacy).length} legacy -> ${MANIFEST}`,
  );
}
