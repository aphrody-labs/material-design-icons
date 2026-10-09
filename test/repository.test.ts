// SPDX-License-Identifier: Apache-2.0
// Consistency of the tracked artifacts: fonts, codepoints, manifest and SVG files.
import { describe, expect, test } from "bun:test";
import { postVersion } from "../scripts/lib/fonttools.ts";
import { MANIFEST, STYLES, abs, fontPath } from "../scripts/lib/layout.ts";
import { axes, codepointsText } from "../scripts/lib/sfnt.ts";
import { buildManifest, manifestText, type Manifest } from "../scripts/manifest.ts";

const bytes = async (rel: string) => new Uint8Array(await Bun.file(abs(rel)).arrayBuffer());

describe("fonts", () => {
  for (const style of STYLES) {
    test(`${style}: optimized variable TTF matching its codepoints`, async () => {
      const ttf = await bytes(fontPath(style, "ttf"));
      expect(postVersion(ttf)).toBe(3);
      expect(axes(ttf).map((a) => a.tag)).toEqual(["FILL", "GRAD", "opsz", "wght"]);
      expect(codepointsText(ttf)).toBe(await Bun.file(abs(fontPath(style, "codepoints"))).text());
      const woff2 = await bytes(fontPath(style, "woff2"));
      expect(new TextDecoder().decode(woff2.subarray(0, 4))).toBe("wOF2");
    });
  }
});

describe("manifest", () => {
  test("is up to date", async () => {
    expect(manifestText(await buildManifest())).toBe(await Bun.file(abs(MANIFEST)).text());
  });

  test("every SVG of the manifest exists in optimized form", async () => {
    const m = (await Bun.file(abs(MANIFEST)).json()) as Manifest;
    expect(m.count).toBe(Object.keys(m.symbols).length);
    const names = Object.keys(m.symbols);
    // A spread sample keeps the test fast; `bun run check` scans every file.
    for (let i = 0; i < names.length; i += 97) {
      const entry = m.symbols[names[i]!]!;
      for (const pair of Object.values(entry.svg))
        for (const path of pair)
          expect(await Bun.file(abs(path)).text()).toContain('viewBox="0 0 24 24"');
    }
  });

  test("every font ligature resolves to a symbol, an alias or a font-only glyph", async () => {
    const m = (await Bun.file(abs(MANIFEST)).json()) as Manifest;
    for (const target of Object.values(m.aliases))
      expect(m.symbols[target]?.codepoint).toBeString();
    for (const style of STYLES) {
      const text = await Bun.file(abs(fontPath(style, "codepoints"))).text();
      for (const line of text.split("\n").filter(Boolean)) {
        const name = line.split(" ")[0]!;
        const resolved =
          m.symbols[name]?.codepoint ?? m.symbols[m.aliases[name]!]?.codepoint ?? m.fontOnly[name];
        expect(`${name} ${resolved}`).toBe(line);
      }
    }
  });
});
