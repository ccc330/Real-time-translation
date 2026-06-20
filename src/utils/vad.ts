/**
 * Energy-based voice activity gate.
 *
 * Purpose is cost control: only forward audio frames that contain speech, so we
 * don't pay the STT vendor for silence. It is deliberately simple (RMS threshold
 * + hangover + pre-roll) — utterance completion is handled server-side, not here.
 *
 * - threshold: RMS above which a frame counts as speech (Float32 samples, -1..1).
 * - hangoverMs: keep forwarding this long after speech drops, so word tails and
 *   short intra-word gaps are not clipped.
 * - prerollFrames: how many pre-speech frames to flush on onset, so word starts
 *   are not clipped.
 */
export interface SpeechGateOptions {
  threshold?: number;
  hangoverMs?: number;
  prerollFrames?: number;
}

export class SpeechGate {
  private threshold: number;
  private hangoverMs: number;
  private prerollFrames: number;

  private speaking = false;
  private lastVoiceAt = 0;
  private preroll: Float32Array[] = [];

  constructor(opts: SpeechGateOptions = {}) {
    this.threshold = opts.threshold ?? 0.008;
    this.hangoverMs = opts.hangoverMs ?? 400;
    this.prerollFrames = opts.prerollFrames ?? 3;
  }

  /** Returns the frames that should be forwarded for this input frame (0..n). */
  process(frame: Float32Array, now: number = Date.now()): Float32Array[] {
    const rms = this.rms(frame);

    if (rms >= this.threshold) {
      this.lastVoiceAt = now;
      if (!this.speaking) {
        this.speaking = true;
        const flushed = this.preroll;
        this.preroll = [];
        return [...flushed, frame];
      }
      return [frame];
    }

    // Below threshold.
    if (this.speaking) {
      if (now - this.lastVoiceAt <= this.hangoverMs) return [frame]; // hangover tail
      this.speaking = false;
    }
    // Idle: keep a short rolling pre-roll for the next onset.
    this.preroll.push(frame);
    if (this.preroll.length > this.prerollFrames) this.preroll.shift();
    return [];
  }

  private rms(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }
}
