// ─────────────────────────────────────────────────────────────────────────────
// Audio playback engine — Tone.js v14
//
// Tone.Transport handles sample-accurate scheduling and BPM.
// PolySynth handles polyphony (chords, overlapping notes).
// ─────────────────────────────────────────────────────────────────────────────

import * as Tone from 'tone'
import type { Score, Note, Chord, Hairpin } from '@shared/score'
import { resolveDirectiveDynamic, resolveDirectiveMidiProgram, resolveDirectiveTempo, resolveKeySig, buildPlaybackSequence, buildFlatSchedule, eventToSeconds, articulationPlaybackMods, expandOrnamentNotes, type FlatScheduleEntry } from '@shared/musicUtils'

// Re-export so callers that import from here continue to work
export { eventToSeconds }

// ── Pitch → frequency ────────────────────────────────────────────────────────

const SEMITONES_FROM_C: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

export function pitchToHz(noteName: string, octave: number, accidental: string | null, transposeSemitones: number = 0): number {
  let semi = SEMITONES_FROM_C[noteName] ?? 0
  if (accidental === 'sharp')            semi += 1
  else if (accidental === 'flat')        semi -= 1
  else if (accidental === 'doubleSharp') semi += 2
  else if (accidental === 'doubleFlat')  semi -= 2
  const midi = (octave + 1) * 12 + semi - transposeSemitones
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PlaybackController {
  stop: () => void
  getPositionSec: () => number
}

export async function playScore(
  score: Score,
  bpm = 120,
  onStop?: () => void,
  resumeFrom = 0,
): Promise<PlaybackController> {
  await Tone.start()

  Tone.Transport.stop()
  Tone.Transport.cancel()
  Tone.Transport.bpm.value = bpm

  const synth = new Tone.PolySynth(Tone.Synth).toDestination()
  synth.set({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 },
  })
  synth.volume.value = -6  // dB

  let totalDuration = 0

  const tempoStaff = score.parts[0]?.staves[0]
  const sequence   = buildPlaybackSequence(tempoStaff?.measures ?? [], score.voltas ?? [])

  function buildHairpinDbMap(
    hairpins: readonly Hairpin[] | undefined,
    schedule: FlatScheduleEntry[],
  ): Map<string, number> {
    const map = new Map<string, number>()
    if (!hairpins?.length) return map
    const START_DB = -6, END_DB = 0   // dB bonus: softer → louder
    for (const hairpin of hairpins) {
      const fromIdx = schedule.findIndex(fe => fe.event.id === hairpin.fromNoteId)
      const toIdx   = schedule.findIndex(fe => fe.event.id === hairpin.toNoteId)
      if (fromIdx === -1 || toIdx === -1) continue
      const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx)
      for (let i = lo; i <= hi; i++) {
        const t = hi > lo ? (i - lo) / (hi - lo) : 0
        map.set(schedule[i].event.id,
          hairpin.type === 'crescendo' ? START_DB + (END_DB - START_DB) * t : END_DB + (START_DB - END_DB) * t)
      }
    }
    return map
  }

  for (const part of score.parts) {
    if (part.muted) continue
    const staff = part.staves[0]
    if (!staff || !tempoStaff) continue

    const schedule    = buildFlatSchedule(staff, sequence, tempoStaff, bpm, score.timeSignature)
    const hairpinDbs  = buildHairpinDbMap(staff.hairpins, schedule)

    for (const fe of schedule) {
      if (fe.skip) continue
      const { event, mIdx, startSec, playDurSec } = fe

      const dynMultiplier = resolveDirectiveDynamic(staff.measures, mIdx)
      const volumeScale   = dynMultiplier ?? part.volume
      const volDb         = 20 * Math.log10(Math.max(0.001, volumeScale))
      const hairpinDb     = hairpinDbs.get(event.id) ?? 0
      const effectiveMidi = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
      const isPizz        = effectiveMidi === 45

      const keySig     = resolveKeySig(staff.measures, mIdx, score.keySignature)
      const bpmAtEvent = resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
      const ornNotes   = expandOrnamentNotes(event, startSec, playDurSec, bpmAtEvent, keySig)
      if (ornNotes) {
        for (const on of ornNotes) {
          const hz = pitchToHz(on.noteName, on.octave, on.accidental, part.transposeSemitones)
          const db = volDb + hairpinDb
          Tone.Transport.schedule((time) => {
            synth.set({ envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 } })
            synth.volume.value = db
            synth.triggerAttackRelease(hz, on.durSec, time)
          }, on.startSec)
        }
        continue
      }

      const { durFactor, volDbBonus } = articulationPlaybackMods(event)
      const effectiveDur = playDurSec * durFactor
      const effectiveDb  = volDb + volDbBonus + hairpinDb

      if (event.type === 'note') {
        const n   = event as Note
        const hz  = pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
        const db  = effectiveDb
        const plucked = isPizz
        Tone.Transport.schedule((time) => {
          synth.set({ envelope: plucked
            ? { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 }
            : { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 } })
          synth.volume.value = db
          synth.triggerAttackRelease(hz, effectiveDur, time)
        }, startSec)
      } else if (event.type === 'chord') {
        const c     = event as Chord
        const freqs = c.pitches.map(p => pitchToHz(p.noteName, p.octave, p.accidental, part.transposeSemitones))
        const db    = effectiveDb
        const plucked = isPizz
        Tone.Transport.schedule((time) => {
          synth.set({ envelope: plucked
            ? { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 }
            : { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 } })
          synth.volume.value = db
          freqs.forEach(hz => synth.triggerAttackRelease(hz, effectiveDur, time))
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
      setTimeout(() => synth.dispose(), 300)
      onStop?.()
    }
  }, totalDuration + 0.3)

  Tone.Transport.start('+0', resumeFrom > 0 ? resumeFrom : undefined)

  return {
    stop() {
      if (stopped) return
      stopped = true
      Tone.Transport.stop()
      Tone.Transport.cancel()
      synth.releaseAll()
      setTimeout(() => synth.dispose(), 300)
      onStop?.()
    },
    getPositionSec: () => Tone.Transport.seconds,
  }
}
