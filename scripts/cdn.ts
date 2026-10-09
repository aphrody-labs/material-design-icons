#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// CDN release of the fonts on cdn.aphrody.com, served by aphrody-fonts-proxy (`--static <root>/current`):
//   /h/<sha16>.<ext>                       content-addressed WOFF2, TTF and CSS, immutable for a year
//   /s/symbols/material-symbols.css        stable URL of the current CSS (1 h cache)
//   /s/symbols/release.json                commit, URLs, sizes and sha256 of the current release
// Host layout: <root>/releases/<id> holds one complete release (h/ and s/), <root>/current links to it and
// is switched atomically; the previous release stays for rollback (switch the link back).
// Usage:
//   bun scripts/cdn.ts build   [--origin https://cdn.aphrody.com] [--out dist/cdn]
//   bun scripts/cdn.ts publish --host dbfr [--root /home/ubuntu/apps/cdn/symbols] [--out dist/cdn] [--dry-run]
//   bun scripts/cdn.ts verify  [--out dist/cdn]
import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MANIFEST, ROOT, STYLES, abs, family, fontPath, type Style } from "./lib/layout.ts";

export const SCOPE = "symbols";
const KEEP_RELEASES = 2;

const sha256 = (data: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");

export interface ReleaseFile {
  style: Style | null;
  kind: "woff2" | "ttf" | "css";
  bytes: number;
  sha256: string;
  url: string;
}

export interface Release {
  id: string;
  scope: string;
  /** Commit of the aphrody branch the fonts were built from. */
  commit: string;
  symbols: number;
  css: { stable: string; hashed: string };
  files: ReleaseFile[];
}

export function materialSymbolsCss(woff2: Record<Style, string>): string {
  const faces = STYLES.map(
    (style) => `@font-face {
  font-family: "${family(style)}";
  font-style: normal;
  font-weight: 100 700;
  font-display: block;
  src: url(${woff2[style]}) format("woff2");
}`,
  ).join("\n");
  const classes = STYLES.map((s) => `.material-symbols-${s}`).join(",\n");
  const families = STYLES.map(
    (s) => `.material-symbols-${s} {\n  font-family: "${family(s)}";\n}`,
  ).join("\n");
  return `/* Material Symbols Outlined, Rounded and Sharp (Apache-2.0, Google): variable fonts FILL 0..1,
   wght 100..700, GRAD -50..200, opsz 20..48. Classes compatible with fonts.googleapis.com; FILL and GRAD
   follow --material-symbols-fill and --material-symbols-grad, wght follows font-weight and opsz the size. */
${faces}
${classes} {
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: "liga";
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-variation-settings:
    "FILL" var(--material-symbols-fill, 0),
    "GRAD" var(--material-symbols-grad, 0);
}
${families}
`;
}

export async function buildRelease(origin: string, out: string): Promise<Release> {
  const base = origin.replace(/\/$/, "");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "h"), { recursive: true });
  await mkdir(join(out, "s", SCOPE), { recursive: true });
  const files: ReleaseFile[] = [];
  const woff2 = {} as Record<Style, string>;
  for (const style of STYLES) {
    for (const kind of ["woff2", "ttf"] as const) {
      const data = new Uint8Array(await Bun.file(abs(fontPath(style, kind))).arrayBuffer());
      const hash = sha256(data);
      const name = `${hash.slice(0, 16)}.${kind}`;
      await Bun.write(join(out, "h", name), data);
      const url = `${base}/h/${name}`;
      files.push({ style, kind, bytes: data.length, sha256: hash, url });
      if (kind === "woff2") woff2[style] = url;
    }
  }
  const css = materialSymbolsCss(woff2);
  const cssHash = sha256(css);
  const cssName = `${cssHash.slice(0, 16)}.css`;
  await Bun.write(join(out, "h", cssName), css);
  await Bun.write(join(out, "s", SCOPE, "material-symbols.css"), css);
  files.push({
    style: null,
    kind: "css",
    bytes: new TextEncoder().encode(css).length,
    sha256: cssHash,
    url: `${base}/h/${cssName}`,
  });
  const manifest = (await Bun.file(abs(MANIFEST)).json()) as { count: number };
  const release: Release = {
    id: sha256(files.map((f) => `${f.sha256} ${f.kind}\n`).join("")).slice(0, 12),
    scope: SCOPE,
    commit: (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim(),
    symbols: manifest.count,
    css: { stable: `${base}/s/${SCOPE}/material-symbols.css`, hashed: `${base}/h/${cssName}` },
    files,
  };
  await Bun.write(join(out, "s", SCOPE, "release.json"), `${JSON.stringify(release, null, 1)}\n`);
  return release;
}

export async function publish(host: string, root: string, out: string, dryRun: boolean) {
  const release = (await Bun.file(join(out, "s", SCOPE, "release.json")).json()) as Release;
  if (!/^[a-z0-9]+$/.test(release.id) || !/^\/[A-Za-z0-9._/-]+$/.test(root))
    throw new Error("refused id or root");
  const dir = `${root}/releases/${release.id}`;
  const ssh = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host];
  await $`${ssh} ${`mkdir -p ${dir}`}`;
  // --chmod: a tree built on a Windows checkout reaches the host 0777 otherwise.
  await $`rsync -a --delete --chmod=D755,F644 ${dryRun ? ["--dry-run"] : []} ${out.replaceAll("\\", "/")}/ ${host}:${dir}/`;
  if (dryRun) return release;
  // Atomic switch, then drop the releases older than the previous one.
  const swap = [
    `cd ${root}`,
    `ln -sfn releases/${release.id} .current.next`,
    "mv -T .current.next current",
    `ls -1dt releases/* | tail -n +${KEEP_RELEASES + 1} | grep -v "^releases/${release.id}$" | xargs -r rm -rf`,
  ].join(" && ");
  await $`${ssh} ${swap}`;
  return release;
}

export async function verify(release: Release) {
  const failures: string[] = [];
  const urls = [
    ...release.files.map((f) => [f.url, f.kind] as const),
    [release.css.stable, "css"] as const,
  ];
  const types = { woff2: "font/woff2", ttf: "font/ttf", css: "text/css" };
  for (const [url, kind] of urls) {
    const res = await fetch(url, { method: "HEAD" });
    const type = res.headers.get("content-type") ?? "";
    const cache = res.headers.get("cache-control") ?? "";
    const cors = res.headers.get("access-control-allow-origin");
    const immutable = url.includes("/h/");
    const ok =
      res.status === 200 &&
      type.startsWith(types[kind]) &&
      cors === "*" &&
      (!immutable || cache.includes("immutable"));
    console.log(`${res.status} ${type} | ${cache} | cors ${cors} | ${url}`);
    if (!ok) failures.push(url);
  }
  return failures;
}

if (import.meta.main) {
  const [command, ...argv] = process.argv.slice(2);
  const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1]! : fallback;
  };
  const out = resolve(ROOT, opt("out", "dist/cdn"));
  const origin = opt("origin", "https://cdn.aphrody.com");
  if (command === "build") {
    const r = await buildRelease(origin, out);
    console.log(
      `cdn: release ${r.id}, ${r.files.length} files -> ${out}\n  ${r.css.stable}\n  ${r.css.hashed}`,
    );
  } else if (command === "publish") {
    const host = opt("host", "");
    if (!host) throw new Error("publish: --host is required");
    const r = await publish(
      host,
      opt("root", "/home/ubuntu/apps/cdn"),
      out,
      argv.includes("--dry-run"),
    );
    console.log(`cdn: release ${r.id} published on ${host}`);
  } else if (command === "verify") {
    const r = (await Bun.file(join(out, "s", SCOPE, "release.json")).json()) as Release;
    const failures = await verify(r);
    if (failures.length) {
      console.error(`cdn: ${failures.length} URL(s) failed`);
      process.exit(1);
    }
  } else {
    console.error("usage: bun scripts/cdn.ts build|publish|verify [options]");
    process.exit(2);
  }
}
