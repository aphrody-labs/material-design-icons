#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Refresh the Material Symbols sources from Google Fonts (Bun port of upstream update/update_symbols.py,
// reduced to what the aphrody branch keeps): the 24 px SVGs (weight 400, grade 0, fill 0 and 1) of every
// icon whose version changed, and the three variable fonts. Then fonts, SVG optimization and manifest run.
// Usage: bun scripts/update.ts [--overwrite] [--icon-limit N] [--no-fetch] [--no-build] [--jobs 32]
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  STYLES,
  VERSIONS,
  abs,
  family,
  fontBase,
  styleDir,
  svgPath,
  type Style,
} from "./lib/layout.ts";

/** Google WOFF2 downloads, the input of scripts/fonts.ts (ignored by git). */
const GOOGLE_DIR = "build/google";

const METADATA_URL = "https://fonts.google.com/metadata/icons?incomplete=1&key=material_symbols";
const CSS2 = "https://fonts.googleapis.com/css2";
const AXES = "opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

interface Metadata {
  host: string;
  families: string[];
  icons: { name: string; version: number; unsupported_families: string[] }[];
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};

export async function latestMetadata(): Promise<Metadata> {
  const res = await fetch(METADATA_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`metadata: HTTP ${res.status}`);
  // The body starts with the `)]}'` XSSI guard and a newline.
  return JSON.parse((await res.text()).slice(5)) as Metadata;
}

export const styleOf = (fam: string): Style | null => {
  const s = fam.replace("Material Symbols ", "").toLowerCase();
  return (STYLES as readonly string[]).includes(s) ? (s as Style) : null;
};

export function iconUrl(host: string, name: string, style: Style, fill: boolean) {
  return `https://${host}/s/i/short-term/release/${styleDir(style)}/${name}/${fill ? "fill1" : "default"}/24px.svg`;
}

async function download(url: string, dest: string) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await Bun.write(dest, res);
}

async function pool<T>(items: T[], jobs: number, run: (item: T) => Promise<void>) {
  let next = 0;
  let done = 0;
  const errors: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        try {
          await run(item);
        } catch (e) {
          errors.push((e as Error).message);
        }
        if (++done % 2000 === 0) console.log(`${done}/${items.length} complete`);
      }
    }),
  );
  return errors;
}

async function fetchFont(style: Style) {
  const url = `${CSS2}?family=${family(style).replaceAll(" ", "+")}:${AXES}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const css = await res.text();
  const src = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
  if (!src?.endsWith(".woff2")) throw new Error(`${family(style)}: no woff2 in css2 answer`);
  await download(src, abs(`${GOOGLE_DIR}/${fontBase(style)}.woff2`));
  console.log(`font: ${family(style)} <- ${src}`);
}

if (import.meta.main) {
  const overwrite = flag("overwrite");
  const limit = option("icon-limit", 0);
  const jobs = option("jobs", 32);
  const versionsFile = Bun.file(abs(VERSIONS));
  const versions = (await versionsFile.json()) as Record<string, number>;
  const metadata = await latestMetadata();
  const styles = metadata.families.map(styleOf).filter((s): s is Style => s !== null);
  let icons = metadata.icons;
  if (limit > 0) icons = icons.slice(0, limit);

  const fetches: { url: string; dest: string }[] = [];
  let changed = 0;
  for (const icon of icons) {
    const key = `symbols::${icon.name}`;
    if (!overwrite && icon.version <= (versions[key] ?? 0)) continue;
    versions[key] = icon.version;
    changed++;
    const unsupported = new Set(icon.unsupported_families);
    for (const style of styles) {
      if (unsupported.has(family(style))) continue;
      for (const fill of [false, true])
        fetches.push({
          url: iconUrl(metadata.host, icon.name, style, fill),
          dest: abs(svgPath(icon.name, style, fill)),
        });
    }
  }
  console.log(`${changed}/${icons.length} icons have changed, ${fetches.length} svg fetches`);

  if (flag("no-fetch")) {
    console.log("fetch disabled");
    process.exit(0);
  }
  const errors = await pool(fetches, jobs, (f) => download(f.url, f.dest));
  for (const style of styles) await fetchFont(style);
  // Sorted keys, 4-space indent: the format of the upstream json.dump(..., indent=4, sort_keys=True).
  const sorted = Object.fromEntries(Object.entries(versions).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(versionsFile, JSON.stringify(sorted, null, 4));
  if (errors.length) {
    console.error(errors.slice(0, 20).join("\n"));
    console.error(`${errors.length} fetch(es) failed`);
  }
  if (!flag("no-build")) {
    for (const step of [
      ["fonts.ts", "--source", GOOGLE_DIR],
      ["optimize-svg.ts"],
      ["manifest.ts"],
    ]) {
      const [script, ...args] = step as [string, ...string[]];
      const r = Bun.spawnSync(["bun", abs(`scripts/${script}`), ...args], {
        stdout: "inherit",
        stderr: "inherit",
      });
      if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
    }
  }
  process.exit(errors.length ? 1 : 0);
}
