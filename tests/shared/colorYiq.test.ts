import { describe, expect, it } from "vitest";
import { isLightByYiq, yiqBrightness } from "../../src/shared/colorYiq";

describe("YIQ background tendency", () => {
  it.each([[0, false], [127, false], [127.999, false], [128, true], [255, true]])(
    "classifies gray %s at the 128 boundary", (channel, light) => {
      const rgb = { r: channel as number, g: channel as number, b: channel as number };
      expect(yiqBrightness(rgb)).toBeCloseTo(channel as number);
      expect(isLightByYiq(rgb)).toBe(light);
    });
  it("uses the YIQ channel weights", () => {
    expect(yiqBrightness({ r: 255, g: 0, b: 0 })).toBeCloseTo(76.245);
    expect(yiqBrightness({ r: 0, g: 255, b: 0 })).toBeCloseTo(149.685);
    expect(yiqBrightness({ r: 0, g: 0, b: 255 })).toBeCloseTo(29.07);
  });
});
