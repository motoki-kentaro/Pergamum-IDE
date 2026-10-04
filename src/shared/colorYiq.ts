/** Background brightness tendency, not an accessibility verdict. */
export const YIQ_LIGHT_THRESHOLD = 128;

export function yiqBrightness({ r, g, b }: { r: number; g: number; b: number }): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function isLightByYiq(rgb: { r: number; g: number; b: number }): boolean {
  return yiqBrightness(rgb) >= YIQ_LIGHT_THRESHOLD;
}
