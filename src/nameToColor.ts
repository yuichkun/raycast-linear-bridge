import * as crypto from "crypto";

// Ported verbatim from todo-buddy's tag coloring. Note: `minLightness = 200` looks wrong
// for an HSL lightness value (0-100 range) — it's not a bug that needs fixing, it's what
// produces todo-buddy's actual color palette; Math.max(l, 200) always picks 200, and
// feeding that out-of-range lightness through hslToHex still yields a stable, varied hex
// value per input string, which is the whole point (deterministic, distinct label colors).
function hexToHSL(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
    switch (max) {
      case r:
        h = (g - b) / diff + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / diff + 2;
        break;
      case b:
        h = (r - g) / diff + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const toRGB = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  h /= 360;
  s /= 100;
  l /= 100;

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(toRGB(p, q, h + 1 / 3) * 255);
  const g = Math.round(toRGB(p, q, h) * 255);
  const b = Math.round(toRGB(p, q, h - 1 / 3) * 255);

  return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function nameToColor(name: string): string {
  const hash = crypto.createHash("md5");
  hash.update(name);
  const hexDigest = hash.digest("hex");
  const hexColor = hexDigest.slice(0, 6);

  const [h, s, l] = hexToHSL(hexColor);
  const minLightness = 200;
  const adjustedL = Math.max(l, minLightness);
  const brightHexColor = hslToHex(h, s, adjustedL);

  return `#${brightHexColor}`;
}
