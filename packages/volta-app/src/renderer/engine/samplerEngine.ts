import * as Tone from 'tone'
import type { Score, Note, Chord } from '@shared/score'
import { resolveDirectiveDynamic, resolveDirectiveMidiProgram, resolveDirectiveTempo, resolveKeySig, buildPlaybackSequence, buildFlatSchedule, buildSequenceSchedule, articulationPlaybackMods, expandOrnamentNotes } from '@shared/musicUtils'
import { pitchToHz, type PlaybackController } from './audioEngine'
import { scheduleDrumHit, releaseDrumSampler } from './drumSamplerEngine'

// ── Salamander Grand Piano samples (bundled) ──────────────────────────────────

const SAMPLE_BASE_URL = './samples/piano/'
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
  resumeFrom = 0,
  getPartVolume?: (partId: string) => number,
  isPartMuted?: (partId: string) => boolean,
): Promise<PlaybackController> {
  loadSampler()

  if (!_samplerReady) {
    const { playScore } = await import('./audioEngine')
    return playScore(score, bpm, onStop, resumeFrom, getPartVolume, isPartMuted)
  }

  await Tone.start()

  Tone.getContext().lookAhead = 0.3

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

    const partId = part.id

    if (part.inputMode === 'sequencer') {
      const seqEntries = buildSequenceSchedule(part, sequence, tempoStaff, bpm, score.timeSignature)
      const isDrumPart = (part.midiChannel ?? 1) === 10
      const vol = part.volume
      for (const entry of seqEntries) {
        if (entry.startSec < resumeFrom) continue
        Tone.Transport.schedule((time) => {
          if (isPartMuted?.(partId)) return
          const liveVol = getPartVolume?.(partId) ?? vol
          const volDb   = 20 * Math.log10(Math.max(0.001, liveVol))
          if (isDrumPart) {
            scheduleDrumHit(entry.midiPitch, entry.velocity / 127, volDb, time)
          } else {
            const hz = 440 * Math.pow(2, (entry.midiPitch - 69) / 12)
            sampler.volume.value = volDb
            sampler.triggerAttackRelease(hz, entry.durSec * 0.9, time)
          }
        }, entry.startSec)
        totalDuration = Math.max(totalDuration, entry.startSec + entry.durSec)
      }
      continue
    }

    const schedule = buildFlatSchedule(staff, sequence, tempoStaff, bpm, score.timeSignature, staff.slurs)

    for (const fe of schedule) {
      if (fe.skip) continue
      const { event, mIdx, startSec, playDurSec } = fe

      const dynMultiplier = resolveDirectiveDynamic(staff.measures, mIdx)
      const effectiveMidi = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
      const isPizz        = effectiveMidi === 45

      const keySig     = resolveKeySig(staff.measures, mIdx, score.keySignature)
      const bpmAtEvent = resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
      const ornNotes   = expandOrnamentNotes(event, startSec, playDurSec, bpmAtEvent, keySig)
      if (ornNotes) {
        for (const on of ornNotes) {
          const hz = pitchToHz(on.noteName, on.octave, on.accidental, part.transposeSemitones)
          Tone.Transport.schedule((time) => {
            if (isPartMuted?.(partId)) return
            const liveVolume = dynMultiplier ?? (getPartVolume?.(partId) ?? part.volume)
            sampler.volume.value = 20 * Math.log10(Math.max(0.001, liveVolume))
            sampler.triggerAttackRelease(hz, on.durSec, time)
          }, on.startSec)
        }
        continue
      }

      const { durFactor, volDbBonus } = articulationPlaybackMods(event)
      const effectiveDur  = isPizz ? Math.min(playDurSec * durFactor, 0.3) : playDurSec * durFactor
      const { legatoUntilSec } = fe

      if (event.type === 'note') {
        const n  = event as Note
        const hz = pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
        Tone.Transport.schedule((time) => {
          if (isPartMuted?.(partId)) return
          const partVol     = getPartVolume?.(partId) ?? part.volume
          const explicitVel = (n as any).velocity as number | undefined
          const liveVolume  = explicitVel !== undefined
            ? partVol * (explicitVel / 127)
            : dynMultiplier ?? partVol
          sampler.volume.value = 20 * Math.log10(Math.max(0.001, liveVolume)) + volDbBonus
          sampler.triggerAttack(hz, time)
        }, startSec)
        Tone.Transport.schedule((time) => { sampler.triggerRelease(hz, time) },
          legatoUntilSec ?? startSec + effectiveDur)
      } else if (event.type === 'chord') {
        const freqs = (event as unknown as Chord).pitches
          .map(p => pitchToHz(p.noteName, p.octave, p.accidental, part.transposeSemitones))
        Tone.Transport.schedule((time) => {
          if (isPartMuted?.(partId)) return
          const partVol     = getPartVolume?.(partId) ?? part.volume
          const explicitVel = (event as any).velocity as number | undefined
          const liveVolume  = explicitVel !== undefined
            ? partVol * (explicitVel / 127)
            : dynMultiplier ?? partVol
          sampler.volume.value = 20 * Math.log10(Math.max(0.001, liveVolume)) + volDbBonus
          freqs.forEach(hz => sampler.triggerAttack(hz, time))
        }, startSec)
        const relTime = legatoUntilSec ?? startSec + effectiveDur
        freqs.forEach(hz =>
          Tone.Transport.schedule((time) => { sampler.triggerRelease(hz, time) }, relTime)
        )
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
      setTimeout(() => {
        Tone.Transport.stop()
        Tone.Transport.cancel()
        onStop?.()
      }, 0)
    }
  }, totalDuration + 0.5)

  Tone.Transport.start('+0', resumeFrom > 0 ? resumeFrom : undefined)

  return {
    stop() {
      if (stopped) return
      stopped = true
      Tone.Transport.stop()
      Tone.Transport.cancel()
      sampler.releaseAll()
      releaseDrumSampler()
      onStop?.()
    },
    getPositionSec: () => Tone.Transport.seconds,
  }
}
