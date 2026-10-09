// SPDX-License-Identifier: Apache-2.0
// Minimal OpenType reader: Unicode cmap and GSUB ligatures, enough to list the icon names of a
// Material Symbols font. Port of the upstream update/icons.py (fontTools) to Bun.

export interface Sfnt {
  view: DataView;
  tables: Map<string, { offset: number; length: number }>;
}

export function readSfnt(bytes: Uint8Array): Sfnt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (
    version !== 0x00010000 &&
    version !== 0x4f54544f /* OTTO */ &&
    version !== 0x74727565 /* true */
  )
    throw new Error(
      `not an OpenType font (sfnt version 0x${version.toString(16)}; decompress WOFF2 first)`,
    );
  const numTables = view.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(rec),
      view.getUint8(rec + 1),
      view.getUint8(rec + 2),
      view.getUint8(rec + 3),
    );
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return { view, tables };
}

function table(font: Sfnt, tag: string): number {
  const t = font.tables.get(tag);
  if (!t) throw new Error(`missing ${tag} table`);
  return t.offset;
}

/** Same subtables as fontTools `CmapSubtable.isUnicode()`. */
const isUnicode = (platform: number, encoding: number) =>
  platform === 0 || (platform === 3 && (encoding === 0 || encoding === 1 || encoding === 10));

/** Codepoint -> glyph id over every Unicode cmap subtable (later subtables win, as fontTools' dict.update). */
export function unicodeCmap(font: Sfnt): Map<number, number> {
  const { view } = font;
  const base = table(font, "cmap");
  const count = view.getUint16(base + 2);
  const map = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const rec = base + 4 + i * 8;
    if (!isUnicode(view.getUint16(rec), view.getUint16(rec + 2))) continue;
    const sub = base + view.getUint32(rec + 4);
    const format = view.getUint16(sub);
    if (format === 4) {
      const segX2 = view.getUint16(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = view.getUint16(ends + s);
        const start = view.getUint16(starts + s);
        const delta = view.getInt16(deltas + s);
        const ro = view.getUint16(rangeOffsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (ro === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = view.getUint16(rangeOffsets + s + ro + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) map.set(c, glyph);
        }
      }
    } else if (format === 12 || format === 13) {
      const groups = view.getUint32(sub + 12);
      for (let g = 0; g < groups; g++) {
        const p = sub + 16 + g * 12;
        const start = view.getUint32(p);
        const end = view.getUint32(p + 4);
        const glyph = view.getUint32(p + 8);
        for (let c = start; c <= end; c++) map.set(c, format === 12 ? glyph + (c - start) : glyph);
      }
    } else if (format === 6) {
      const first = view.getUint16(sub + 6);
      const n = view.getUint16(sub + 8);
      for (let k = 0; k < n; k++) {
        const glyph = view.getUint16(sub + 10 + k * 2);
        if (glyph !== 0) map.set(first + k, glyph);
      }
    } else if (format === 0) {
      for (let c = 0; c < 256; c++) {
        const glyph = view.getUint8(sub + 6 + c);
        if (glyph !== 0) map.set(c, glyph);
      }
    }
    // Format 14 (variation sequences) maps no codepoint on its own, as in fontTools.
  }
  return map;
}

function coverage(view: DataView, at: number): number[] {
  const format = view.getUint16(at);
  const out: number[] = [];
  if (format === 1) {
    const n = view.getUint16(at + 2);
    for (let i = 0; i < n; i++) out.push(view.getUint16(at + 4 + i * 2));
  } else if (format === 2) {
    const n = view.getUint16(at + 2);
    for (let i = 0; i < n; i++) {
      const r = at + 4 + i * 6;
      const start = view.getUint16(r);
      const end = view.getUint16(r + 2);
      const index = view.getUint16(r + 4);
      for (let g = start; g <= end; g++) out[index + g - start] = g;
    }
  } else throw new Error(`coverage format ${format}`);
  return out;
}

export interface Ligature {
  components: number[];
  glyph: number;
}

/** Every ligature of GSUB type 4 lookups, direct or behind type 7 extensions. */
export function gsubLigatures(font: Sfnt): Ligature[] {
  const { view } = font;
  const gsub = table(font, "GSUB");
  const lookupList = gsub + view.getUint16(gsub + 8);
  const lookups = view.getUint16(lookupList);
  const out: Ligature[] = [];
  const ligatureSubtable = (sub: number) => {
    if (view.getUint16(sub) !== 1) throw new Error("ligature substitution format");
    const firsts = coverage(view, sub + view.getUint16(sub + 2));
    const sets = view.getUint16(sub + 4);
    for (let s = 0; s < sets; s++) {
      const set = sub + view.getUint16(sub + 6 + s * 2);
      const n = view.getUint16(set);
      for (let l = 0; l < n; l++) {
        const lig = set + view.getUint16(set + 2 + l * 2);
        const glyph = view.getUint16(lig);
        const count = view.getUint16(lig + 2);
        const components = [firsts[s]!];
        for (let c = 1; c < count; c++) components.push(view.getUint16(lig + 4 + (c - 1) * 2));
        out.push({ components, glyph });
      }
    }
  };
  for (let i = 0; i < lookups; i++) {
    const lookup = lookupList + view.getUint16(lookupList + 2 + i * 2);
    const type = view.getUint16(lookup);
    const subs = view.getUint16(lookup + 4);
    for (let k = 0; k < subs; k++) {
      const sub = lookup + view.getUint16(lookup + 6 + k * 2);
      if (type === 4) ligatureSubtable(sub);
      else if (type === 7 && view.getUint16(sub + 2) === 4)
        ligatureSubtable(sub + view.getUint32(sub + 4));
    }
  }
  return out;
}

const isPua = (cp: number) =>
  (cp >= 0xe000 && cp <= 0xf8ff) ||
  (cp >= 0xf0000 && cp <= 0xffffd) ||
  (cp >= 0x100000 && cp <= 0x10fffd);

/** (icon name, codepoint) for every ligature producing a Private Use Area glyph, sorted like Python `sorted()`. */
export function iconCodepoints(bytes: Uint8Array): [string, number][] {
  const font = readSfnt(bytes);
  const cmap = unicodeCmap(font);
  // fontTools' reverse map keeps the last codepoint of a glyph in ascending codepoint order.
  const reverse = new Map<number, number>();
  for (const cp of [...cmap.keys()].sort((a, b) => a - b)) reverse.set(cmap.get(cp)!, cp);
  const out: [string, number][] = [];
  for (const lig of gsubLigatures(font)) {
    const chars = lig.components.map((g) => reverse.get(g));
    const cp = reverse.get(lig.glyph);
    if (cp === undefined || !isPua(cp) || chars.some((c) => c === undefined)) continue;
    out.push([String.fromCodePoint(...(chars as number[])), cp]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}

/** The `.codepoints` text of update/icons.py: `name hex` lines, hex lowercase and at least 4 digits. */
export function codepointsText(bytes: Uint8Array): string {
  return iconCodepoints(bytes)
    .map(([name, cp]) => `${name} ${cp.toString(16).padStart(4, "0")}\n`)
    .join("");
}

/** Variation axes of the fvar table: tag, min, default, max. */
export function axes(bytes: Uint8Array): { tag: string; min: number; def: number; max: number }[] {
  const font = readSfnt(bytes);
  const { view } = font;
  const fvar = table(font, "fvar");
  const first = fvar + view.getUint16(fvar + 4);
  const count = view.getUint16(fvar + 8);
  const size = view.getUint16(fvar + 10);
  const fixed = (p: number) => view.getInt32(p) / 65536;
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = first + i * size;
    out.push({
      tag: String.fromCharCode(
        view.getUint8(a),
        view.getUint8(a + 1),
        view.getUint8(a + 2),
        view.getUint8(a + 3),
      ),
      min: fixed(a + 4),
      def: fixed(a + 8),
      max: fixed(a + 12),
    });
  }
  return out;
}

export const glyphCount = (bytes: Uint8Array) => {
  const font = readSfnt(bytes);
  return font.view.getUint16(table(font, "maxp") + 4);
};
