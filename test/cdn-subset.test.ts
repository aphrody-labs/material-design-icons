// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { materialSymbolsCss } from "../scripts/cdn.ts";
import type { Manifest } from "../scripts/manifest.ts";
import { resolveNames } from "../scripts/subset.ts";

describe("material-symbols.css", () => {
  const css = materialSymbolsCss({
    outlined: "https://cdn.example/s/h/aaaa.woff2",
    rounded: "https://cdn.example/s/h/bbbb.woff2",
    sharp: "https://cdn.example/s/h/cccc.woff2",
  });

  test("Google-compatible classes and families", () => {
    for (const [cls, fam] of [
      ["outlined", "Material Symbols Outlined"],
      ["rounded", "Material Symbols Rounded"],
      ["sharp", "Material Symbols Sharp"],
    ])
      expect(css).toContain(`.material-symbols-${cls} {\n  font-family: "${fam}";\n}`);
    expect(css).toContain('font-feature-settings: "liga"');
    expect(css).toContain('"FILL" var(--material-symbols-fill, 0)');
  });

  test("one variable WOFF2 face per style, font-display block", () => {
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css.match(/font-display: block;/g)).toHaveLength(3);
    expect(css.match(/font-weight: 100 700;/g)).toHaveLength(3);
    expect(css).toContain('src: url(https://cdn.example/s/h/bbbb.woff2) format("woff2");');
  });
});

describe("subset names", () => {
  const manifest = {
    symbols: {
      home: { codepoint: "e9b2", svg: {} },
      search: { codepoint: "e8b6", svg: {} },
      app_spark: { codepoint: null, svg: {} },
    },
    aliases: { home_filled: "home" },
    fontOnly: { g_translate: "e927" },
  } as unknown as Manifest;

  test("names, aliases, font-only glyphs and Private Use Area characters", () => {
    const got = resolveNames(
      [
        "home",
        "home_filled",
        String.fromCodePoint(0xe8b6),
        "g_translate",
        String.fromCodePoint(0xe927),
      ],
      manifest,
    );
    expect([...got]).toEqual([
      ["home", "e9b2"],
      ["search", "e8b6"],
      ["g_translate", "e927"],
    ]);
  });

  test("unknown names fail", () => {
    expect(() => resolveNames(["nope"], manifest)).toThrow("unknown symbol: nope");
    expect(() => resolveNames([" "], manifest)).toThrow("no symbol requested");
    expect(() => resolveNames(["app_spark"], manifest)).toThrow("not in the fonts yet: app_spark");
  });
});
