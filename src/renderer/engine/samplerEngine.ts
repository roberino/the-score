import * as Tone from 'tone'
import type { Score, Note, Chord } from '@shared/score'
import { resolveDirectiveDynamic, resolveDirectiveMidiProgram, resolveDirectiveTempo, resolveKeySig, buildPlaybackSequence, buildFlatSchedule, articulationPlaybackMods, expandOrnamentNotes } from '@shared/musicUtils'
import { pitchToHz, type PlaybackController } from './audioEngine'

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
  loadSampler()

  if (!_samplerReady) {
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
  const sequence   = buildPlaybackSequence(tempoStaff?.measures ?? [], score.voltas ?? [])

  for (const part of score.parts) {
    if (part.muted) continue
    const staff = part.staves[0]
    if (!staff || !tempoStaff) continue

    const schedule = buildFlatSchedule(staff, sequence, tempoStaff, bpm, score.timeSignature)

    for (const fe of schedule) {
      if (fe.skip) continue
      const { event, mIdx, startSec, playDurSec } = fe

      const dynMultiplier = resolveDirectiveDynamic(staff.measures, mIdx)
      const volumeScale   = dynMultiplier ?? part.volume
      const volDb         = 20 * Math.log10(Math.max(0.001, volumeScale))
      const effectiveMidi = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
      const isPizz        = effectiveMidi === 45

      const keySig     = resolveKeySig(staff.measures, mIdx, score.keySignature)
      const bpmAtEvent = resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
      const ornNotes   = expandOrnamentNotes(event, startSec, playDurSec, bpmAtEvent, keySig)
      if (ornNotes) {
        for (const on of ornNotes) {
          const hz = pitchToHz(on.noteName, on.octave, on.accidental, part.transposeSemitones)
          const db = volDb
          Tone.Transport.schedule((time) => {
            sampler.volume.value = db
            sampler.triggerAttackRelease(hz, on.durSec, time)
          }, on.startSec)
        }
        continue
      }

      const { durFactor, volDbBonus } = articulationPlaybackMods(event)
      const effectiveDur = isPizz ? Math.min(playDurSec * durFactor, 0.3) : playDurSec * durFactor
      const effectiveDb  = volDb + volDbBonus

      if (event.type === 'note') {
        const n  = event as Note
        const hz = pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
        Tone.Transport.schedule((time) => {
          sampler.volume.value = effectiveDb
          sampler.triggerAttackRelease(hz, effectiveDur, time)
        }, startSec)
      } else if (event.type === 'chord') {
        const freqs = (event as unknown as Chord).pitches
          .map(p => pitchToHz(p.noteName, p.octave, p.accidental, part.transposeSemitones))
        Tone.Transport.schedule((time) => {
          sampler.volume.value = effectiveDb
          freqs.forEach(hz => sampler.triggerAttackRelease(hz, effectiveDur, time))
        }, startSec)
      }
    }

    if (schedule.length > 0) {
      const last = schedule[schedule.length - 1]
      totalDuration = Math.max(totalDuration, last.startSec + last.playDurSec)
    }
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
