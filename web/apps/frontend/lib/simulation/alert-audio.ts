import type { BiomassStatus } from './trajectory';

/** Exactly one voice and optional slow LFO; stopping disconnects the entire graph. */
export class AlertAudio {
  private nodes: { voice: OscillatorNode; gain: GainNode; modulation?: OscillatorNode; depth?: GainNode } | undefined;
  constructor(readonly context: AudioContext) {}
  stop() {
    const nodes = this.nodes; this.nodes = undefined; if (!nodes) return;
    nodes.gain.gain.cancelScheduledValues(this.context.currentTime); nodes.gain.gain.setValueAtTime(0,this.context.currentTime);
    for (const oscillator of [nodes.voice,nodes.modulation]) { if (!oscillator) continue; try { oscillator.stop(); } catch { /* Already ended. */ } oscillator.disconnect(); }
    nodes.gain.disconnect(); nodes.depth?.disconnect();
  }
  volume(value: number) { this.nodes?.gain.gain.setTargetAtTime(Math.max(0,Math.min(1,value))*.12,this.context.currentTime,.04); }
  start(state: BiomassStatus, volume: number) {
    this.stop(); if (!['critical_crossed','near_threshold','declining'].includes(state)) return;
    const ctx=this.context, voice=ctx.createOscillator(), gain=ctx.createGain(); voice.connect(gain);gain.connect(ctx.destination);
    this.nodes={voice,gain}; const t=ctx.currentTime, level=Math.max(0,Math.min(1,volume))*.12;
    voice.type='sine'; voice.frequency.setValueAtTime(state==='critical_crossed'?540:state==='near_threshold'?620:440,t);
    gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(level,t+.12);
    if (state==='critical_crossed') {
      const modulation=ctx.createOscillator(), depth=ctx.createGain();modulation.frequency.value=.65;depth.gain.value=170;
      modulation.connect(depth);depth.connect(voice.frequency);this.nodes.modulation=modulation;this.nodes.depth=depth;modulation.start();
    } else {
      const duration=state==='near_threshold'?2.4:.65;
      voice.frequency.linearRampToValueAtTime(state==='near_threshold'?420:370,t+duration*.7);
      gain.gain.linearRampToValueAtTime(0,t+duration);voice.stop(t+duration);
      voice.onended=()=>{ if(this.nodes?.voice===voice)this.stop(); };
    }
    voice.start();
  }
  async close() { this.stop(); await this.context.close(); }
}
