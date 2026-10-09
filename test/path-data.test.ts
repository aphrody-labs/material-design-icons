// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { num, parsePath, rescalePath } from "../scripts/lib/path-data.ts";

describe("rescalePath", () => {
  test("maps 0 -960 960 960 onto 0 0 24 24 exactly", () => {
    // Upstream symbols/web/home/materialsymbolsoutlined/home_24px.svg.
    const d =
      "M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z";
    expect(rescalePath(d)).toBe(
      "M6 19h3v-6h6v6h3v-9L12 5.5L6 10v9Zm-2 2v-12l8 -6l8 6v12H13v-6h-2v6H4Zm8 -8.75Z",
    );
  });

  test("keeps arc flags and radii, shifts only absolute y", () => {
    expect(rescalePath("M480-80a400 400 0 1 1 0-800A400 400 0 0 1 480-80Z")).toBe(
      "M12 22a10 10 0 1 1 0 -20A10 10 0 0 1 12 22Z",
    );
    expect(rescalePath("M0-960a20 20 0 1012 0")).toBe("M0 0a0.5 0.5 0 1 0 0.3 0");
  });

  test("curves and implicit repeats", () => {
    expect(rescalePath("M160-200q0-19 8.5-36t23.5-28C200 -300 100 -400 40 -480s4 4 8 8")).toBe(
      "M4 19q0 -0.475 0.2125 -0.9t0.5875 -0.7C5 16.5 2.5 14 1 12s0.1 0.1 0.2 0.2",
    );
    expect(parsePath("m1 2 3 4").map((s) => s.cmd)).toEqual(["m", "l"]);
  });

  test("one-decimal upstream coordinates stay exact", () => {
    for (let v = -9600; v <= 9600; v += 7) {
      const x = v / 10;
      expect(Number(num(x / 40))).toBe(Number((x / 40).toFixed(4)));
    }
  });

  test("a leading m is absolute", () => {
    // Upstream symbols/web/browse_gallery/materialsymbolssharp/browse_gallery_24px.svg starts with m.
    expect(rescalePath("m472-312 56-56Zm0 20")).toBe("M11.8 16.2l1.4 -1.4Zm0 0.5");
  });

  test("older 0 96 960 960 drawings", () => {
    // Upstream symbols/web/privacy_screen/materialsymbolsrounded/privacy_screen_24px.svg.
    expect(rescalePath("m160 480 144-144H160v144Z", 0, 96, 960)).toBe("M4 9.6l3.6 -3.6H4v3.6Z");
  });

  test("rejects unknown commands", () => {
    expect(() => parsePath("M0 0 X1")).toThrow();
  });
});
