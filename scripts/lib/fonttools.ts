// SPDX-License-Identifier: Apache-2.0
// fontTools through uv: the reference implementation for WOFF2 (de)compression, subsetting and instancing.
// No Python file lives in the repository; `uvx` provisions the pinned version on first use.

export const FONTTOOLS = "fonttools[woff]==4.66.1";

export function fonttools(tool: "fonttools" | "pyftsubset", args: string[]) {
  const r = Bun.spawnSync(["uvx", "--quiet", "--from", FONTTOOLS, tool, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0)
    throw new Error(`${tool} ${args.join(" ")}: exit ${r.exitCode}\n${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

export const woff2Decompress = (input: string, output: string) =>
  fonttools("fonttools", ["ttLib.woff2", "decompress", "-o", output, input]);

export const woff2Compress = (input: string, output: string) =>
  fonttools("fonttools", ["ttLib.woff2", "compress", "-o", output, input]);

/** Version of the `post` table: 3 means no glyph names (the optimized form). */
export function postVersion(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    if (view.getUint32(rec) === 0x706f7374 /* post */)
      return view.getUint32(view.getUint32(rec + 8)) / 65536;
  }
  throw new Error("missing post table");
}
