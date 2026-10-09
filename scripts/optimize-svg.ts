#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Optimize the kept SVG set in place: Material Symbols get an exact rescale to viewBox 0 0 24 24, then svgo;
// the legacy Material Icons kept under src/ get svgo only.
// Usage: bun scripts/optimize-svg.ts [--check] [files...]
//   --check  exit 1 when a file is not in optimized form (nothing is written)
import { optimize, type CustomPlugin } from "svgo";
import { LEGACY_GLOB, ROOT, SVG_GLOB, abs } from "./lib/layout.ts";
import { rescalePath } from "./lib/path-data.ts";

const TARGET_VIEWBOX = "0 0 24 24";
/** Decimals kept in the 24 px grid by svgo; 2 fails the fidelity thresholds of scripts/fidelity.ts. */
export const FLOAT_PRECISION = 3;

/**
 * Upstream ships three drawings of the same 24 px design: `viewBox="0 -960 960 960"` (current),
 * `viewBox="0 96 960 960"` and, without viewBox, `width="24" height="24"` in pixel units (older).
 */
const rescale: CustomPlugin = {
  name: "aphrodyRescale",
  fn: () => {
    let origin: [number, number, number] | null = null;
    return {
      element: {
        enter(node) {
          if (node.attributes.transform) throw new Error(`transform on <${node.name}>`);
          if (node.name === "svg") {
            const vb = node.attributes.viewBox;
            if (vb === TARGET_VIEWBOX) throw new Error("already optimized");
            const box = vb?.split(/[\s,]+/).map(Number);
            if (
              vb === undefined &&
              node.attributes.width === "24" &&
              node.attributes.height === "24"
            )
              origin = null;
            else if (box?.length === 4 && box[2] === 960 && box[3] === 960)
              origin = [box[0]!, box[1]!, 960];
            else throw new Error(`unexpected viewBox ${vb}`);
            node.attributes.viewBox = TARGET_VIEWBOX;
          } else if (node.name === "path") {
            if (origin) node.attributes.d = rescalePath(node.attributes.d ?? "", ...origin);
          } else throw new Error(`unexpected element <${node.name}>`);
        },
      },
    };
  },
};

export function optimizeSvg(svg: string, precision = FLOAT_PRECISION): string {
  const rescaled = optimize(svg, { plugins: [rescale] }).data;
  return optimize(rescaled, {
    multipass: true,
    floatPrecision: precision,
    plugins: [
      {
        name: "preset-default",
        params: { overrides: { convertPathData: { floatPrecision: precision } } },
      },
    ],
  }).data;
}

export const isOptimized = (svg: string) => svg.includes(`viewBox="${TARGET_VIEWBOX}"`);

/**
 * Legacy Material Icons are already drawn on 0 0 24 24: drop the invisible bounding box and metadata.
 * 4 decimals keep their 2-decimal coordinates exact; at 3, svgo turns circles drawn as cubics into arcs.
 */
export function optimizeLegacySvg(svg: string): string {
  return optimize(svg, {
    multipass: true,
    floatPrecision: 4,
    plugins: [
      {
        name: "preset-default",
        params: { overrides: { removeUselessStrokeAndFill: { removeNone: true } } },
      },
    ],
  }).data;
}

const scan = (glob: string) =>
  Array.fromAsync(new Bun.Glob(glob).scan({ cwd: ROOT, onlyFiles: true }));

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const listed = argv.filter((a) => !a.startsWith("--"));
  const files = listed.length
    ? listed
    : (await Promise.all([SVG_GLOB, LEGACY_GLOB].map(scan))).flat();
  let changed = 0;
  let before = 0;
  let after = 0;
  const failures: string[] = [];
  for (const rel of files) {
    const file = Bun.file(abs(rel));
    const svg = await file.text();
    let out: string;
    try {
      if (rel.startsWith("src/")) out = optimizeLegacySvg(svg);
      else out = isOptimized(svg) ? svg : optimizeSvg(svg);
    } catch (e) {
      failures.push(`${rel}: ${(e as Error).message}`);
      continue;
    }
    before += svg.length;
    after += out.length;
    if (out === svg) continue;
    if (check) failures.push(rel);
    else {
      await Bun.write(file, out);
      changed++;
    }
  }
  console.log(
    `svg: ${files.length} files, ${changed} optimized, ${before} -> ${after} bytes${check ? " (check)" : ""}`,
  );
  if (failures.length) {
    console.error(failures.slice(0, 20).join("\n"));
    console.error(`${failures.length} file(s) ${check ? "not optimized" : "failed"}`);
    process.exit(1);
  }
}
