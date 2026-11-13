/**
 * Calque de sprite : un canvas à la résolution native du sprite (ex. 32×32), agrandi
 * en CSS avec `image-rendering: pixelated`, et déplacé par `transform` sur une couche
 * composée par le GPU.
 *
 * - Déplacer l'entité ne redessine rien (seul le compositeur travaille).
 * - Le canvas n'est redessiné que lorsque la frame d'animation change.
 * - L'échelle est accrochée pour qu'un pixel sprite = un nombre entier de pixels écran.
 */
export class SpriteLayer {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  private readonly ctx: CanvasRenderingContext2D;
  private baseScale: number;
  private cssScale = 1;
  private x = Number.NaN;
  private y = Number.NaN;
  private rotation = 0;

  constructor(parent: HTMLElement, width: number, height: number, baseScale: number) {
    this.width = width;
    this.height = height;
    this.baseScale = baseScale;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sprite';
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    this.applyScale();
    parent.append(this.canvas);
  }

  /** Pixels CSS par pixel de sprite. */
  get scale(): number {
    return this.cssScale;
  }

  get displayWidth(): number {
    return this.width * this.cssScale;
  }

  get displayHeight(): number {
    return this.height * this.cssScale;
  }

  /** À rappeler si le devicePixelRatio change (changement d'écran / de zoom). */
  applyScale(baseScale = this.baseScale): void {
    this.baseScale = baseScale;
    const dpr = window.devicePixelRatio || 1;
    this.cssScale = Math.max(1, Math.round(baseScale * dpr)) / dpr;
    this.canvas.style.width = `${this.displayWidth}px`;
    this.canvas.style.height = `${this.displayHeight}px`;
  }

  drawFrame(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    flipX = false,
  ): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (flipX) {
      ctx.save();
      ctx.translate(this.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, this.width, this.height);
      ctx.restore();
    } else {
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, this.width, this.height);
    }
  }

  /**
   * Position du coin haut-gauche en px CSS, accrochée au pixel physique.
   * `rotation` en degrés, autour du bas du sprite (oscillation du sac de frappe).
   */
  setPosition(x: number, y: number, rotation = 0): void {
    const dpr = window.devicePixelRatio || 1;
    const rx = Math.round(x * dpr) / dpr;
    const ry = Math.round(y * dpr) / dpr;
    const rot = Math.round(rotation * 10) / 10;
    if (rx === this.x && ry === this.y && rot === this.rotation) return;
    this.x = rx;
    this.y = ry;
    this.rotation = rot;
    this.canvas.style.transform = rot
      ? `translate3d(${rx}px, ${ry}px, 0) rotate(${rot}deg)`
      : `translate3d(${rx}px, ${ry}px, 0)`;
  }

  destroy(): void {
    this.canvas.remove();
  }
}
