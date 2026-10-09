#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Optional web subsets: a WOFF2 per style holding only the listed symbols (ligature + codepoint), like
// the `icon_names=` / `text=` parameters of the Google Fonts CSS API.
// Usage:
//   bun scripts/subset.ts --text "home search settings"     names (or Private Use Area characters)
//   bun scripts/subset.ts --manifest icons.json              JSON array of names, or { "names": [...] }
//   [--styles outlined,rounded] [--axes "FILL=0:1 wght=400 GRAD=0 opsz=24"] [--out dist/subset]
// Each output is verified: its ligatures are exactly the requested ones.
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fonttools, woff2Compress } from "./lib/fonttools.ts";
import { MANIFEST, STYLES, abs, fontPath, type Style } from "./lib/layout.ts";
import { codepointsText } from "./lib/sfnt.ts";
import type { Manifest } from "./manifest.ts";

export interface SubsetRequest {
  names: string[];
  styles: Style[];
  /** fontTools instancer limits, e.g. ["wght=400", "FILL=0:1"]; empty keeps every axis whole. */
  axes: string[];
  out: string;
}

/** Resolves names, aliases and PUA characters to canonical names with their codepoints. */
export function resolveNames(tokens: string[], manifest: Manifest): Map<string, string> {
  const byCp = new Map(Object.entries(manifest.fontOnly).map(([n, cp]) => [cp, n]));
  for (const [n, s] of Object.entries(manifest.symbols)) if (s.codepoint) byCp.set(s.codepoint, n);
  const out = new Map<string, string>();
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    const cp = token.codePointAt(0)!;
    const pua = [...token].length === 1 && ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000);
    const name = pua
      ? byCp.get(cp.toString(16).padStart(4, "0"))
      : manifest.symbols[token] || manifest.fontOnly[token]
        ? token
        : manifest.aliases[token];
    if (!name) throw new Error(`unknown symbol: ${token}`);
    const codepoint = manifest.symbols[name]?.codepoint ?? manifest.fontOnly[name];
    if (!codepoint) throw new Error(`not in the fonts yet: ${name}`);
    out.set(name, codepoint);
  }
  if (!out.size) throw new Error("no symbol requested");
  return out;
}

export async function subset(req: SubsetRequest, manifest: Manifest) {
  const wanted = resolveNames(req.names, manifest);
  const expected = [...wanted]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([n, cp]) => `${n} ${cp}\n`)
    .join("");
  const text = [...new Set([...wanted.keys()].join(""))].join("");
  await mkdir(req.out, { recursive: true });
  const results = [];
  for (const style of req.styles) {
    let input = abs(fontPath(style, "ttf"));
    const stem = basename(input, ".ttf").replace(/\[.*\]/, "");
    const tmp = join(req.out, `${stem}.tmp.ttf`);
    if (req.axes.length) {
      const pinned = join(req.out, `${stem}.instance.ttf`);
      fonttools("fonttools", ["varLib.instancer", input, ...req.axes, "-o", pinned]);
      input = pinned;
    }
    fonttools("pyftsubset", [
      input,
      `--unicodes=${[...wanted.values()].map((cp) => `U+${cp}`).join(",")}`,
      `--text=${text}`,
      "--layout-features=*",
      "--no-layout-closure",
      `--output-file=${tmp}`,
    ]);
    const got = codepointsText(new Uint8Array(await Bun.file(tmp).arrayBuffer()));
    if (got !== expected) throw new Error(`${style}: subset ligatures differ from the request`);
    const woff2 = join(req.out, `${stem}.subset.woff2`);
    woff2Compress(tmp, woff2);
    await rm(tmp, { force: true });
    if (req.axes.length) await rm(input, { force: true });
    results.push({ style, file: woff2, bytes: Bun.file(woff2).size });
  }
  await Bun.write(
    join(req.out, "subset.json"),
    JSON.stringify({ symbols: Object.fromEntries(wanted), axes: req.axes, results }, null, 1),
  );
  return results;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = (await Bun.file(abs(MANIFEST)).json()) as Manifest;
  let names: string[] = [];
  const text = opt("text") ?? opt("names");
  if (text) names = text.split(/[\s,]+/);
  const list = opt("manifest");
  if (list) {
    const data = (await Bun.file(list).json()) as string[] | { names: string[] };
    names.push(...(Array.isArray(data) ? data : data.names));
  }
  const styles = (opt("styles")?.split(",") ?? [...STYLES]) as Style[];
  for (const s of styles)
    if (!(STYLES as readonly string[]).includes(s)) throw new Error(`unknown style ${s}`);
  try {
    const results = await subset(
      {
        names,
        styles,
        axes: opt("axes")?.split(/\s+/).filter(Boolean) ?? [],
        out: abs(opt("out") ?? "dist/subset"),
      },
      manifest,
    );
    for (const r of results) console.log(`subset: ${r.style} ${r.bytes} B -> ${r.file}`);
  } catch (e) {
    console.error(`subset: ${(e as Error).message}`);
    process.exit(1);
  }
}
