import { describe,it,expect,vi } from 'vitest';
import { AlertAudio } from '@/lib/simulation/alert-audio';
function fixture(){
  const voices:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;frequency:{value:number;setValueAtTime:ReturnType<typeof vi.fn>;linearRampToValueAtTime:ReturnType<typeof vi.fn>}}[]=[];
  const gains:{gain:{value:number;setValueAtTime:ReturnType<typeof vi.fn>;cancelScheduledValues:ReturnType<typeof vi.fn>;linearRampToValueAtTime:ReturnType<typeof vi.fn>;setTargetAtTime:ReturnType<typeof vi.fn>};disconnect:ReturnType<typeof vi.fn>}[]=[];
  const context={currentTime:10,destination:{},close:vi.fn(),createOscillator:()=>{const voice={start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),connect:vi.fn(),frequency:{value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()}};voices.push(voice);return voice;},createGain:()=>{const gain={connect:vi.fn(),disconnect:vi.fn(),gain:{value:0,setValueAtTime:vi.fn(),cancelScheduledValues:vi.fn(),linearRampToValueAtTime:vi.fn(),setTargetAtTime:vi.fn()}};gains.push(gain);return gain;}};
  return {player:new AlertAudio(context as unknown as AudioContext),context,voices,gains};
}
describe('Single-voice alert audio graph',()=>{
  it('loops red through a slow LFO without scheduled stop or JS timers, then tears down immediately',()=>{
    const {player,voices,gains}=fixture();player.start('critical_crossed',.25);expect(voices).toHaveLength(2);expect(voices[1]!.frequency.value).toBe(.65);expect(voices[0]!.stop).not.toHaveBeenCalled();
    player.volume(.5);expect(gains[0]!.gain.setTargetAtTime).toHaveBeenCalledWith(.06,10,.04);
    player.stop();expect(voices.every(v=>v.stop.mock.calls.length===1&&v.disconnect.mock.calls.length===1)).toBe(true);expect(gains[0]!.gain.setValueAtTime).toHaveBeenLastCalledWith(0,10);
    player.stop();expect(voices[0]!.stop).toHaveBeenCalledTimes(1);
  });
  it('distinguishes finite orange and yellow and stops the prior graph before replacement',()=>{
    const {player,voices}=fixture();player.start('near_threshold',.25);expect(voices[0]!.stop).toHaveBeenCalledWith(12.4);
    player.start('declining',.25);expect(voices[0]!.disconnect).toHaveBeenCalledOnce();expect(voices[1]!.stop).toHaveBeenCalledWith(10.65);
    player.start('favorable',.25);expect(voices[1]!.disconnect).toHaveBeenCalledOnce();expect(voices).toHaveLength(2);
  });
});
