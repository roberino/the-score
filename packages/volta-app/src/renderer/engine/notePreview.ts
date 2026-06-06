import * as Tone from 'tone'
import { isSamplerReady, previewWithSampler } from './samplerEngine'

let _synth: Tone.Synth | null = null

function getSynth(): Tone.Synth {
  if (!_synth) {
    _synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 },
    }).toDestination()
  }
  return _synth
}

export async function previewNote(hz: number, volumeDb: number, isPizz: boolean): Promise<void> {
  await Tone.start()

  if (isSamplerReady()) {
    previewWithSampler(hz, volumeDb, isPizz)
    return
  }

  // Sampler not yet loaded — fall back to triangle synth
  const synth = getSynth()
  synth.set({
    envelope: isPizz
      ? { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 }
      : { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 },
  })
  synth.volume.value = volumeDb
  synth.triggerAttackRelease(hz, 0.4)
}
