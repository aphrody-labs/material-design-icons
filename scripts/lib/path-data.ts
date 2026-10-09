// SPDX-License-Identifier: Apache-2.0
// Exact affine rescale of SVG path data onto `0 0 24 24`: Material Symbols are drawn in
// `viewBox="0 -960 960 960"` (older files `0 96 960 960`), so x' = x / 40, y' = (y + 960) / 40. Upstream
// coordinates carry at most one decimal, so every result is a finite decimal of at most four digits.

const PARAMS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export interface Segment {
  cmd: string;
  args: number[];
}

export function parsePath(d: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let cmd = "";
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  skip();
  while (i < d.length) {
    const ch = d[i]!;
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in PARAMS)) throw new Error(`unknown path command ${ch}`);
      cmd = ch;
      i++;
      if (cmd.toLowerCase() === "z") {
        out.push({ cmd, args: [] });
        skip();
        continue;
      }
    } else if (!cmd || cmd.toLowerCase() === "z") throw new Error(`number without command at ${i}`);
    const n = PARAMS[cmd.toLowerCase()]!;
    const args: number[] = [];
    for (let k = 0; k < n; k++) {
      skip();
      if (cmd.toLowerCase() === "a" && (k === 3 || k === 4)) {
        // Arc flags are single 0/1 digits and may be written without separators.
        const f = d[i];
        if (f !== "0" && f !== "1") throw new Error(`bad arc flag at ${i}`);
        args.push(Number(f));
        i++;
        continue;
      }
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(d);
      if (!m) throw new Error(`expected number at ${i} in ${d.slice(i, i + 16)}`);
      args.push(Number(m[0]));
      i = NUMBER.lastIndex;
    }
    out.push({ cmd, args });
    // An implicit repeat of M is L (m is l).
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    skip();
  }
  return out;
}

/** Shortest decimal for a value that is exact to `digits` decimals. */
export function num(v: number, digits = 6): string {
  let s = Number(v.toFixed(digits)).toString();
  if (s === "-0") s = "0";
  return s;
}

export function stringifyPath(segs: Segment[]): string {
  return segs
    .map(({ cmd, args }) => cmd + args.map((a, k) => (k === 0 ? num(a) : ` ${num(a)}`)).join(""))
    .join("");
}

/**
 * Rescale path data drawn in the viewBox `minX minY size size` onto `0 0 24 24`:
 * x' = (x - minX) * 24 / size, y' = (y - minY) * 24 / size. The default is the current upstream
 * `0 -960 960 960`; older upstream files use `0 96 960 960`.
 */
export function rescalePath(d: string, minX = 0, minY = -960, size = 960): string {
  const scale = 24 / size;
  const segs = parsePath(d).map(({ cmd, args }, index) => {
    // A leading `m` has no current point: SVG reads it as absolute.
    if (index === 0 && cmd === "m") cmd = "M";
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toLowerCase();
    const x = (v: number) => (rel ? v : v - minX) * scale;
    const y = (v: number) => (rel ? v : v - minY) * scale;
    let out: number[];
    switch (c) {
      case "h":
        out = [x(args[0]!)];
        break;
      case "v":
        out = [y(args[0]!)];
        break;
      case "a":
        out = [
          args[0]! * scale,
          args[1]! * scale,
          args[2]!,
          args[3]!,
          args[4]!,
          x(args[5]!),
          y(args[6]!),
        ];
        break;
      case "z":
        out = [];
        break;
      default:
        out = args.map((v, k) => (k % 2 === 0 ? x(v) : y(v)));
    }
    return { cmd, args: out };
  });
  return stringifyPath(segs);
}
