#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Build the two kept font forms of each style from the Google WOFF2 (or the tracked one):
//   desktop  variablefont/<base>.ttf    TrueType variable font, glyph names dropped (post v3), hinting kept
//   web      variablefont/<base>.woff2  the same font, WOFF2 (Brotli) compressed
// and regenerate variablefont/<base>.codepoints from the TTF ligatures. A build fails when a glyph, a
// ligature or an axis of the source is missing from the output.
// Usage: bun scripts/fonts.ts [--source <dir with <base>.woff2>] [--check]
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { postVersion, fonttools, woff2Compress, woff2Decompress } from "./lib/fonttools.ts";
import { STYLES, abs, fontBase, fontPath, type Style } from "./lib/layout.ts";
import { axes, codepointsText, glyphCount } from "./lib/sfnt.ts";

const WORK = abs("build/fonts");

const bytesOf = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());
const signature = (b: Uint8Array) => ({
  glyphs: glyphCount(b),
  axes: JSON.stringify(axes(b)),
  codepoints: codepointsText(b),
});

function same(a: ReturnType<typeof signature>, b: ReturnType<typeof signature>, what: string) {
  if (a.glyphs !== b.glyphs) throw new Error(`${what}: ${b.glyphs} glyphs instead of ${a.glyphs}`);
  if (a.axes !== b.axes) throw new Error(`${what}: axes differ`);
  if (a.codepoints !== b.codepoints) throw new Error(`${what}: ligatures differ`);
}

export async function buildStyle(style: Style, sourceDir: string) {
  const base = fontBase(style);
  const full = join(WORK, `${base}.source.ttf`);
  woff2Decompress(join(sourceDir, `${base}.woff2`), full);
  const ttf = abs(fontPath(style, "ttf"));
  const woff2 = abs(fontPath(style, "woff2"));
  fonttools("pyftsubset", [
    full,
    "--unicodes=*",
    "--glyphs=*",
    "--layout-features=*",
    "--layout-scripts=*",
    "--notdef-outline",
    "--name-IDs=*",
    "--name-languages=*",
    "--name-legacy",
    "--legacy-kern",
    "--drop-tables=",
    `--output-file=${ttf}`,
  ]);
  const want = signature(await bytesOf(full));
  const got = await bytesOf(ttf);
  same(want, signature(got), `${base}.ttf`);
  woff2Compress(ttf, woff2);
  const back = join(WORK, `${base}.roundtrip.ttf`);
  woff2Decompress(woff2, back);
  same(want, signature(await bytesOf(back)), `${base}.woff2`);
  await Bun.write(abs(fontPath(style, "codepoints")), want.codepoints);
  return { glyphs: want.glyphs, ligatures: want.codepoints.split("\n").length - 1 };
}

export async function checkStyle(style: Style) {
  const base = fontBase(style);
  const ttf = await bytesOf(abs(fontPath(style, "ttf")));
  if (postVersion(ttf) !== 3)
    throw new Error(`${base}.ttf: not optimized (post v${postVersion(ttf)})`);
  const sig = signature(ttf);
  if ((await Bun.file(abs(fontPath(style, "codepoints"))).text()) !== sig.codepoints)
    throw new Error(`${base}.codepoints: stale`);
  const back = join(WORK, `${base}.check.ttf`);
  woff2Decompress(abs(fontPath(style, "woff2")), back);
  same(sig, signature(await bytesOf(back)), `${base}.woff2`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--source");
  const source = i >= 0 ? abs(argv[i + 1]!) : abs("variablefont");
  await mkdir(WORK, { recursive: true });
  try {
    for (const style of STYLES) {
      if (argv.includes("--check")) {
        await checkStyle(style);
        console.log(`fonts: ${style} ok`);
      } else {
        const r = await buildStyle(style, source);
        console.log(
          `fonts: ${style} ${r.glyphs} glyphs, ${r.ligatures} ligatures, ttf ${Bun.file(abs(fontPath(style, "ttf"))).size} B, woff2 ${Bun.file(abs(fontPath(style, "woff2"))).size} B`,
        );
      }
    }
  } catch (e) {
    console.error(`fonts: ${(e as Error).message}`);
    process.exit(1);
  } finally {
    await rm(WORK, { recursive: true, force: true });
  }
}
