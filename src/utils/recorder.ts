import { SpeechGate } from './vad';
import workletUrl from './pcm-worklet.js?url';

/**
 * Captures mic audio at 16 kHz and emits PCM16 chunks (as ArrayBuffer, sent over
 * the WebSocket as binary frames). Prefers AudioWorklet (audio-thread capture,
 * ~20ms latency, no main-thread jank) and falls back to ScriptProcessorNode.
 * Silence is dropped by a VAD gate so we don't pay the STT vendor for it.
 */
export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private onAudioCallback: (pcm: ArrayBuffer) => void;
  private onErrorCallback: (error: any) => void;
  private gate: SpeechGate | null;

  constructor(
    onAudio: (pcm: ArrayBuffer) => void,
    onError: (error: any) => void,
    useVad: boolean = true,
  ) {
    this.onAudioCallback = onAudio;
    this.onErrorCallback = onError;
    this.gate = useVad ? new SpeechGate() : null;
  }

  async start() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // Browser downsamples the mic stream to 16 kHz.
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      try {
        await this.audioContext.audioWorklet.addModule(workletUrl);
        this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-worklet');
        this.workletNode.port.onmessage = (e) => this.handleFloatFrame(e.data as Float32Array);
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
      } catch {
        // Fallback for browsers without AudioWorklet: smaller buffer than before
        // (256 ≈ 16ms) to keep input latency low.
        this.processorNode = this.audioContext.createScriptProcessor(256, 1, 1);
        this.processorNode.onaudioprocess = (e) =>
          this.handleFloatFrame(e.inputBuffer.getChannelData(0));
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);
      }
    } catch (err: any) {
      console.error('AudioRecorder initialization error:', err);
      this.onErrorCallback(err);
      this.stop();
    }
  }

  private handleFloatFrame(frame: Float32Array) {
    const frames = this.gate ? this.gate.process(frame) : [frame];
    for (const f of frames) {
      this.onAudioCallback(this.floatTo16BitPCM(f));
    }
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  private floatTo16BitPCM(floatSamples: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(floatSamples.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < floatSamples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }
}
