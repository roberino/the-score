import * as Tone from 'tone'
import type { Score, Note, Chord } from '@shared/score'
import { resolveDirectiveTempo, resolveDirectiveDynamic, resolveDirectiveMidiProgram, buildPlaybackSequence } from '@shared/musicUtils'
import { pitchToHz, eventToSeconds, type PlaybackController } from './audioEngine'

// ── Salamander Grand Piano samples (Tone.js CDN) ──────────────────────────────

const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'
const SAMPLE_URLS: Record<string, string> = {
  A0: 'A0.mp3',  C1: 'C1.mp3',  'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  A1: 'A1.mp3',  C2: 'C2.mp3',  'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  A2: 'A2.mp3',  C3: 'C3.mp3',  'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',  C4: 'C4.mp3',  'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  A4: 'A4.mp3',  C5: 'C5.mp3',  'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',  C6: 'C6.mp3',  'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
  A6: 'A6.mp3',  C7: 'C7.mp3',  'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
  A7: 'A7.mp3',  C8: 'C8.mp3',
}

// ── Singleton sampler ─────────────────────────────────────────────────────────

let _sampler: Tone.Sampler | null = null
let _samplerReady = false
let _loadPromise: Promise<Tone.Sampler> | null = null

export function loadSampler(): Promise<Tone.Sampler> {
  if (_loadPromise) return _loadPromise
  _loadPromise = new Promise<Tone.Sampler>((resolve) => {
    _sampler = new Tone.Sampler({
      urls:    SAMPLE_URLS,
      baseUrl: SAMPLE_BASE_URL,
      onload:  () => { _samplerReady = true; resolve(_sampler!) },
    }).toDestination()
  })
  return _loadPromise
}

export function isSamplerReady(): boolean { return _samplerReady }

export function previewWithSampler(hz: number, volDb: number, isPizz: boolean): void {
  if (!_sampler || !_samplerReady) return
  _sampler.volume.value = volDb
  _sampler.triggerAttackRelease(hz, isPizz ? 0.25 : 0.5, Tone.now())
}

// ── Playback ──────────────────────────────────────────────────────────────────

export async function playScoreWithSampler(
  score: Score,
  bpm = 120,
  onStop?: () => void,
): Promise<PlaybackController> {
  // Kick off loading (no-op if already started); if not ready yet, fall back to synth
  loadSampler()

  if (!_samplerReady) {
    // Samples still loading — import lazily to avoid circular dep at module level
    const { playScore } = await import('./audioEngine')
    return playScore(score, bpm, onStop)
  }

  await Tone.start()

  const sampler = _sampler!

  Tone.Transport.stop()
  Tone.Transport.cancel()
  Tone.Transport.bpm.value = bpm

  let totalDuration = 0
  const tempoStaff = score.parts[0]?.staves[0]
  const sequence   = buildPlaybackSequence(tempoStaff?.measures ?? [])

  for (const part of score.parts) {
    if (part.muted) continue
    const staff = part.staves[0]
    if (!staff) continue

    let partTime = 0

    for (const mIdx of sequence) {
      const measure = staff.measures[mIdx]

      const effectiveBpm = tempoStaff
        ? resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
        : bpm

      const dynMultiplier = resolveDirectiveDynamic(staff.measures, mIdx)
      const volumeScale   = dynMultiplier ?? part.volume
      const volDb         = 20 * Math.log10(Math.max(0.001, volumeScale))

      const effectiveMidi = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
      const isPizz        = effectiveMidi === 45

      for (const event of measure.voices[0]?.events ?? []) {
        const dur = eventToSeconds(event, effectiveBpm)
        const t   = partTime

        if (event.type === 'note') {
          const n  = event as Note
          const hz = pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
          Tone.Transport.schedule((time) => {
            sampler.volume.value = volDb
            if (isPizz) {
              // Plucked feel: shorten the release by triggering a quick note
              sampler.triggerAttackRelease(hz, Math.min(dur, 0.3), time)
            } else {
              sampler.triggerAttackRelease(hz, dur, time)
            }
          }, t)
        } else if (event.type === 'chord') {
          const freqs = (event as unknown as Chord).pitches
            .map(p => pitchToHz(p.noteName, p.octave, p.accidental, part.transposeSemitones))
          Tone.Transport.schedule((time) => {
            sampler.volume.value = volDb
            freqs.forEach(hz => sampler.triggerAttackRelease(hz, dur, time))
          }, t)
        }

        partTime += dur
      }
    }

    totalDuration = Math.max(totalDuration, partTime)
  }

  let stopped = false

  Tone.Transport.schedule(() => {
    if (!stopped) {
      stopped = true
      Tone.Transport.stop()
      Tone.Transport.cancel()
      onStop?.()
    }
  }, totalDuration + 0.5)

  Tone.Transport.start()

  return {
    stop() {
      if (stopped) return
      stopped = true
      Tone.Transport.stop()
      Tone.Transport.cancel()
      sampler.releaseAll()
      onStop?.()
    },
  }
}
