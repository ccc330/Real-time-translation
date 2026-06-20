// AudioWorklet processor: captures mic audio on the audio thread (128-sample
// render quanta) and posts ~20ms Float32 batches to the main thread, which does
// VAD + PCM16 conversion + WS send. Replaces the deprecated, main-thread,
// 64ms-latency ScriptProcessorNode. Plain JS (runs in an isolated worklet realm).
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = [];
    this.count = 0;
    this.BATCH = 320; // 20ms @ 16 kHz
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.batch.push(new Float32Array(ch)); // copy: the input buffer is reused
      this.count += ch.length;
      if (this.count >= this.BATCH) {
        const out = new Float32Array(this.count);
        let o = 0;
        for (const f of this.batch) { out.set(f, o); o += f.length; }
        this.batch = [];
        this.count = 0;
        this.port.postMessage(out, [out.buffer]); // transferable, zero-copy
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
