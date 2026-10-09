// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { MAX_CHANNEL_DIFF, MAX_DIFF_RATIO, compare, render } from "../scripts/fidelity.ts";
import { isOptimized, optimizeLegacySvg, optimizeSvg } from "../scripts/optimize-svg.ts";

const ORIGINALS = [
  // Upstream home (outlined, fill 0) and home (rounded, fill 1).
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"/></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M160-200v-360q0-19 8.5-36t23.5-28l240-180q21-16 48-16t48 16l240 180q15 11 23.5 28t8.5 36v360q0 33-23.5 56.5T720-120H600q-17 0-28.5-11.5T560-160v-200q0-17-11.5-28.5T520-400h-80q-17 0-28.5 11.5T400-360v200q0 17-11.5 28.5T360-120H240q-33 0-56.5-23.5T160-200Z"/></svg>`,
  // Upstream browse_gallery (sharp): leading relative m.
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m472-312 56-56-128-128v-184h-80v216l152 152Zm248 172v-88q74-35 117-103t43-149q0-81-43-149T720-732v-88q109 38 174.5 131.5T960-480q0 115-65.5 208.5T720-140Zm-360 20q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T0-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T360-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T720-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T360-120Zm0-80q117 0 198.5-81.5T640-480q0-117-81.5-198.5T360-760q-117 0-198.5 81.5T80-480q0 117 81.5 198.5T360-200Zm0-280Z"/></svg>`,
  // Upstream privacy_screen (rounded): older viewBox 0 96 960 960.
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 96 960 960" width="24"><path d="m160 480 144-144H160v144Zm0 280 423-424H416L160 593v167Zm56 56h584V336H696L216 816Zm-56 80q-33 0-56.5-23.5T80 816V336q0-33 23.5-56.5T160 256h640q33 0 56.5 23.5T880 336v480q0 33-23.5 56.5T800 896H160Z"/></svg>`,
  // Oldest form: no viewBox, 24 px coordinates.
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
];

describe("optimizeSvg", () => {
  for (const [i, svg] of ORIGINALS.entries()) {
    test(`witness ${i}: 24 px viewBox, no metadata, same rendering`, () => {
      const out = optimizeSvg(svg);
      expect(isOptimized(out)).toBe(true);
      expect(out).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(out).not.toContain("960");
      // The oldest form gains its viewBox attribute.
      expect(out.length).toBeLessThanOrEqual(svg.length + (svg.includes("viewBox") ? 0 : 20));
      const a = render(svg, 192);
      const b = render(out, 192);
      expect([b.width, b.height]).toEqual([192, 192]);
      const diff = compare(a.pixels, b.pixels);
      expect(diff.maxDiff).toBeLessThanOrEqual(MAX_CHANNEL_DIFF);
      expect(diff.diffRatio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }

  test("legacy Material Icons: bounding box and metadata dropped, idempotent, same rendering", () => {
    // Upstream src/action/info_outline/materialicons, …/materialiconstwotone and src/social/fitbit/materialicons
    // 24px.svg (circles drawn as cubics).
    for (const svg of [
      `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="24" viewBox="0 0 24 24" width="24"><rect fill="none" height="24" width="24"/><path d="M19.89,13.89c1.04,0,1.89-0.85,1.89-1.89s-0.85-1.89-1.89-1.89C18.85,10.11,18,10.96,18,12S18.85,13.89,19.89,13.89z M15.65,13.68c0.93,0,1.68-0.75,1.68-1.68s-0.75-1.68-1.68-1.68c-0.93,0-1.68,0.75-1.68,1.68S14.72,13.68,15.65,13.68z M15.65,9.42 c0.93,0,1.68-0.75,1.68-1.68c0-0.93-0.75-1.68-1.68-1.68c-0.93,0-1.68,0.75-1.68,1.68C13.97,8.67,14.72,9.42,15.65,9.42z M15.65,17.93c0.93,0,1.68-0.75,1.68-1.68c0-0.93-0.75-1.68-1.68-1.68c-0.93,0-1.68,0.75-1.68,1.68 C13.97,17.17,14.72,17.93,15.65,17.93z M11.41,13.47c0.81,0,1.47-0.66,1.47-1.47s-0.66-1.47-1.47-1.47c-0.81,0-1.47,0.66-1.47,1.47 S10.59,13.47,11.41,13.47z M11.41,9.21c0.81,0,1.47-0.66,1.47-1.47s-0.66-1.47-1.47-1.47c-0.81,0-1.47,0.66-1.47,1.47 S10.59,9.21,11.41,9.21z M11.41,17.73c0.81,0,1.47-0.66,1.47-1.47c0-0.81-0.66-1.47-1.47-1.47c-0.81,0-1.47,0.66-1.47,1.47 C9.93,17.07,10.59,17.73,11.41,17.73z M11.41,22c0.81,0,1.47-0.66,1.47-1.47c0-0.81-0.66-1.47-1.47-1.47 c-0.81,0-1.47,0.66-1.47,1.47C9.93,21.34,10.59,22,11.41,22z M11.41,4.94c0.81,0,1.47-0.66,1.47-1.47S12.22,2,11.41,2 c-0.81,0-1.47,0.66-1.47,1.47S10.59,4.94,11.41,4.94z M7.16,13.26c0.7,0,1.26-0.57,1.26-1.26s-0.57-1.26-1.26-1.26 c-0.7,0-1.26,0.57-1.26,1.26S6.46,13.26,7.16,13.26z M7.16,17.51c0.7,0,1.26-0.57,1.26-1.26c0-0.7-0.57-1.26-1.26-1.26 c-0.7,0-1.26,0.57-1.26,1.26C5.9,16.94,6.46,17.51,7.16,17.51z M7.16,9.02c0.7,0,1.26-0.57,1.26-1.26c0-0.7-0.57-1.26-1.26-1.26 c-0.7,0-1.26,0.57-1.26,1.26C5.9,8.45,6.46,9.02,7.16,9.02z M3.29,13.05c0.58,0,1.05-0.47,1.05-1.05s-0.47-1.05-1.05-1.05 c-0.58,0-1.05,0.47-1.05,1.05S2.71,13.05,3.29,13.05z"/></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg" enable-background="new 0 0 24 24" height="24" viewBox="0 0 24 24" width="24"><g><path d="M0,0h24v24H0V0z" fill="none"/><path d="M11,7h2v2h-2V7z M11,11h2v6h-2V11z M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20 c-4.41,0-8-3.59-8-8s3.59-8,8-8s8,3.59,8,8S16.41,20,12,20z"/></g></svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><g fill="none"><path d="M0 0h24v24H0V0z"/><path d="M0 0h24v24H0V0z" opacity=".87"/></g><path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"/></svg>`,
    ]) {
      const out = optimizeLegacySvg(svg);
      expect(out).not.toContain("none");
      expect(out).not.toContain("enable-background");
      expect(optimizeLegacySvg(out)).toBe(out);
      const diff = compare(render(svg, 192).pixels, render(out, 192).pixels);
      expect(diff.maxDiff).toBeLessThanOrEqual(MAX_CHANNEL_DIFF);
      expect(diff.diffRatio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    }
  });

  test("refuses already optimized or foreign files", () => {
    expect(() => optimizeSvg(optimizeSvg(ORIGINALS[0]!))).toThrow("already optimized");
    expect(() =>
      optimizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0"/></svg>`,
      ),
    ).toThrow("unexpected viewBox");
    expect(() =>
      optimizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><circle cx="1" cy="1" r="1"/></svg>`,
      ),
    ).toThrow("unexpected element");
  });
});
