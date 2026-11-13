/**
 * Thème de l'interface : neutre, avec une couleur d'accent tirée du compagnon actif.
 * La couleur saturée la plus présente sur sa planche devient l'accent (menthe pour
 * Byte, rose pour un pack sakura…), éclaircie pour rester lisible sur fond sombre.
 */

const FALLBACK = '#4dfcb0';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Teinte dominante parmi les pixels opaques et saturés ; null si l'image est grise. */
export function dominantAccent(pixels: Uint8ClampedArray): string | null {
  const BINS = 24;
  const count = new Array<number>(BINS).fill(0);
  const sat = new Array<number>(BINS).fill(0);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 200) continue;
    const [h, s, l] = rgbToHsl(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    if (s < 0.35 || l < 0.2 || l > 0.9) continue;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    // Les couleurs vives pèsent plus que les teintes ternes (corps, ombres).
    count[bin]! += s * s;
    sat[bin]! += s * s * s;
  }
  let best = -1;
  for (let i = 0; i < BINS; i++) if (count[i]! > 0 && (best < 0 || count[i]! > count[best]!)) best = i;
  if (best < 0 || count[best]! < 8) return null;
  const hue = Math.round((best + 0.5) * (360 / BINS));
  const s = Math.round(Math.min(0.95, Math.max(0.6, sat[best]! / count[best]!)) * 100);
  // Clarté fixe : lisible sur les fonds sombres, et texte encre lisible dessus.
  return `hsl(${hue} ${s}% 64%)`;
}

/** Applique l'accent du compagnon à toute l'interface (celui du manifeste en priorité). */
export function applyAccentFrom(image: HTMLImageElement, declared?: string): void {
  if (declared && /^#[0-9a-f]{6}$/i.test(declared)) {
    document.documentElement.style.setProperty('--accent', declared);
    return;
  }
  let accent: string | null = null;
  try {
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx && w > 0 && h > 0) {
      ctx.drawImage(image, 0, 0);
      accent = dominantAccent(ctx.getImageData(0, 0, w, h).data);
    }
  } catch (err) {
    console.warn('[thème] accent non calculé', err);
  }
  document.documentElement.style.setProperty('--accent', accent ?? FALLBACK);
}
