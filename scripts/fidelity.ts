#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Fidelity of the optimized SVGs: renders witness glyphs (spread Material Symbols plus every legacy file),
// optimized vs the upstream original read from git, with resvg at 192 px and compares the RGBA pixels.
// Fails above the thresholds.
// Usage: bun scripts/fidelity.ts [--ref origin/master] [--count 50] [--size 192] [--out build/fidelity]
//   --ref   git revision holding the original upstream files
//   --out   writes report.json and, for any failing witness, <name>.orig.png / <name>.opt.png
import { Resvg } from "@resvg/resvg-js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST, ROOT, STYLES, abs, type LegacyTheme, type Style } from "./lib/layout.ts";
import type { Manifest } from "./manifest.ts";

/** No pixel may move by half the range or more: that is ink turning into paper, a visible shape change. */
export const MAX_CHANNEL_DIFF = 127;
/** A pixel differs visibly above this many levels (of 255) on any RGBA channel. */
export const VISIBLE_LEVELS = 16;
/** Share of pixels allowed to differ visibly (anti-aliasing of edges moved by sub-pixel rounding). */
export const MAX_DIFF_RATIO = 0.001;

export interface Witness {
  name: string;
  style: Style | LegacyTheme;
  fill: boolean;
  path: string;
}

/** Evenly spread witnesses over the sorted symbol names, cycling styles and fills. */
export function witnesses(m: Manifest, count: number): Witness[] {
  const names = Object.keys(m.symbols).sort();
  const out: Witness[] = [];
  for (let i = 0; i < count && names.length; i++) {
    const name = names[Math.floor((i * (names.length - 1)) / Math.max(1, count - 1))]!;
    const svg = m.symbols[name]!.svg;
    const style = [STYLES[i % 3]!, ...STYLES].find((s) => svg[s])!;
    const fill = Math.floor(i / 3) % 2 === 1;
    out.push({ name, style, fill, path: svg[style]![fill ? 1 : 0] });
  }
  return out;
}

/** Every kept legacy Material Icons file. */
export const legacyWitnesses = (m: Manifest): Witness[] =>
  Object.entries(m.legacy).flatMap(([name, themes]) =>
    Object.entries(themes).map(([theme, path]) => ({
      name,
      style: theme as LegacyTheme,
      fill: false,
      path,
    })),
  );

export function render(svg: string, size: number) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
  return { width: img.width, height: img.height, pixels: img.pixels, png: () => img.asPng() };
}

export function compare(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return { maxDiff: 255, diffRatio: 1, meanDiff: 255 };
  let maxDiff = 0;
  let sum = 0;
  let differing = 0;
  for (let p = 0; p < a.length; p += 4) {
    let px = 0;
    for (let c = 0; c < 4; c++) px = Math.max(px, Math.abs(a[p + c]! - b[p + c]!));
    maxDiff = Math.max(maxDiff, px);
    sum += px;
    if (px > VISIBLE_LEVELS) differing++;
  }
  const pixels = a.length / 4;
  return { maxDiff, diffRatio: differing / pixels, meanDiff: sum / pixels };
}

/** Reads blobs `<ref>:<path>` in one `git cat-file --batch` call. */
export async function gitBlobs(ref: string, paths: string[]): Promise<string[]> {
  const proc = Bun.spawn(["git", "-C", ROOT, "cat-file", "--batch"], {
    stdin: "pipe",
    stdout: "pipe",
  });
  proc.stdin.write(paths.map((p) => `${ref}:${p}\n`).join(""));
  await proc.stdin.end();
  const data = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  const out: string[] = [];
  const decoder = new TextDecoder();
  let at = 0;
  for (const path of paths) {
    const nl = data.indexOf(10, at);
    const header = decoder.decode(data.subarray(at, nl));
    const size = Number(header.split(" ")[2]);
    if (!header.endsWith(` ${size}`) || header.includes("missing"))
      throw new Error(`${ref}:${path}: ${header}`);
    out.push(decoder.decode(data.subarray(nl + 1, nl + 1 + size)));
    at = nl + 1 + size + 1;
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1]! : fallback;
  };
  const ref = opt("ref", "origin/master");
  const size = Number(opt("size", "192"));
  const out = abs(opt("out", "build/fidelity"));
  const manifest = (await Bun.file(abs(MANIFEST)).json()) as Manifest;
  const list = [...witnesses(manifest, Number(opt("count", "50"))), ...legacyWitnesses(manifest)];
  const originals = await gitBlobs(
    ref,
    list.map((w) => w.path),
  );
  await mkdir(out, { recursive: true });
  const results = [];
  let failed = 0;
  let worstMax = 0;
  let worstRatio = 0;
  for (const [i, w] of list.entries()) {
    const optimized = await Bun.file(abs(w.path)).text();
    const a = render(originals[i]!, size);
    const b = render(optimized, size);
    const r = compare(a.pixels, b.pixels);
    const ok = r.maxDiff <= MAX_CHANNEL_DIFF && r.diffRatio <= MAX_DIFF_RATIO;
    worstMax = Math.max(worstMax, r.maxDiff);
    worstRatio = Math.max(worstRatio, r.diffRatio);
    results.push({
      ...w,
      ok,
      ...r,
      bytes: { original: originals[i]!.length, optimized: optimized.length },
    });
    if (!ok) {
      failed++;
      const stem = `${w.name}.${w.style}${w.fill ? ".fill1" : ""}`;
      await Bun.write(join(out, `${stem}.orig.png`), a.png());
      await Bun.write(join(out, `${stem}.opt.png`), b.png());
    }
  }
  const summary = {
    ref,
    size,
    thresholds: {
      maxChannelDiff: MAX_CHANNEL_DIFF,
      visibleLevels: VISIBLE_LEVELS,
      maxDiffRatio: MAX_DIFF_RATIO,
    },
    witnesses: list.length,
    failed,
    worst: { maxChannelDiff: worstMax, diffRatio: worstRatio },
    results,
  };
  await Bun.write(join(out, "report.json"), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(
    `fidelity: ${list.length - failed}/${list.length} witnesses within thresholds at ${size} px (worst max diff ${worstMax}/255, worst differing pixels ${(worstRatio * 100).toFixed(4)} %)`,
  );
  process.exit(failed ? 1 : 0);
}
