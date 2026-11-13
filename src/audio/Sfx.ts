/**
 * Bruitages synthétisés (WebAudio, aucun fichier) : quelques bips 8-bit très courts.
 * L'AudioContext n'est créé qu'au premier son joué, et seulement si les sons sont
 * activés dans les paramètres. Un pack peut fournir ses propres sons (étape 4).
 */
export type SfxName = 'jump' | 'land' | 'eat' | 'hit' | 'kick' | 'pet' | 'squash' | 'levelup' | 'scared' | 'pop';

type Note = [freq: number, duration: number, type?: OscillatorType];

const SOUNDS: Record<SfxName, Note[]> = {
  jump: [[420, 0.06, 'square'], [640, 0.06, 'square']],
  land: [[140, 0.05, 'triangle']],
  eat: [[300, 0.05, 'square'], [0, 0.04], [260, 0.05, 'square']],
  hit: [[110, 0.06, 'sawtooth']],
  kick: [[220, 0.04, 'square'], [500, 0.05, 'square']],
  pet: [[660, 0.07, 'triangle'], [880, 0.09, 'triangle']],
  squash: [[880, 0.04, 'square'], [440, 0.04, 'square'], [220, 0.06, 'square']],
  levelup: [[523, 0.08, 'square'], [659, 0.08, 'square'], [784, 0.08, 'square'], [1046, 0.14, 'square']],
  scared: [[900, 0.05, 'sawtooth'], [700, 0.08, 'sawtooth']],
  pop: [[500, 0.04, 'triangle']],
};

const VOLUME = 0.08;

export class Sfx {
  private ctx: AudioContext | null = null;
  enabled = false;

  play(name: SfxName): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      let t = ctx.currentTime + 0.01;
      for (const [freq, duration, type = 'square'] of SOUNDS[name]) {
        if (freq > 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(VOLUME, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + duration);
        }
        t += duration;
      }
    } catch (err) {
      console.warn('[sfx]', err);
    }
  }

  private readonly clips = new Map<ArrayBuffer, Promise<AudioBuffer | null>>();

  /** Joue un son fourni par un pack (.ogg/.wav), décodé une seule fois. */
  playClip(data: ArrayBuffer): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      let decoded = this.clips.get(data);
      if (!decoded) {
        decoded = ctx.decodeAudioData(data.slice(0)).catch(() => null);
        this.clips.set(data, decoded);
      }
      void decoded.then((buffer) => {
        if (!buffer || !this.ctx) return;
        const src = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        gain.gain.value = 0.5;
        src.buffer = buffer;
        src.connect(gain).connect(this.ctx.destination);
        src.start();
      });
    } catch (err) {
      console.warn('[sfx]', err);
    }
  }

  /** Libère le contexte audio quand les sons sont désactivés. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
