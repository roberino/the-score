// ─────────────────────────────────────────────────────────────────────────────
// Audio playback engine — Tone.js v14
//
// Tone.Transport handles sample-accurate scheduling and BPM.
// PolySynth handles polyphony (chords, overlapping notes).
// ─────────────────────────────────────────────────────────────────────────────

import * as Tone from 'tone'
import type { Score, Note, Chord, NoteEvent } from '@shared/score'
import { resolveDirectiveTempo, resolveDirectiveDynamic, resolveDirectiveMidiProgram, buildPlaybackSequence } from '@shared/musicUtils'

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

// ── Duration → seconds ───────────────────────────────────────────────────────

const DURATION_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}

export function eventToSeconds(event: NoteEvent, bpm: number): number {
  const beats = DURATION_BEATS[event.duration] ?? 1
  const dotted = event.dots === 2 ? beats * 1.75 : event.dots === 1 ? beats * 1.5 : beats
  return dotted * (60 / bpm)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PlaybackController {
  stop: () => void
}

export async function playScore(
  score: Score,
  bpm = 120,
  onStop?: () => void,
): Promise<PlaybackController> {
  // Resume AudioContext — required after a user gesture in browser environments
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

  let cursor = 0  // seconds — tracks the latest end time across all parts

  // First part's staff used to resolve global tempo directives and repeat structure
  const tempoStaff = score.parts[0]?.staves[0]
  const sequence   = buildPlaybackSequence(tempoStaff?.measures ?? [])

  for (const part of score.parts) {
    if (part.muted) continue
    const staff = part.staves[0]
    if (!staff) continue

    const partCursor = { t: 0 }

    for (const mIdx of sequence) {
      const measure = staff.measures[mIdx]

      // Resolve effective BPM at this measure (global — uses first part's staff)
      const effectiveBpm = tempoStaff
        ? resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
        : bpm

      // Resolve volume multiplier from dynamics (per-part)
      const dynMultiplier = resolveDirectiveDynamic(staff.measures, mIdx)
      const volumeScale   = dynMultiplier ?? part.volume
      const volDb         = 20 * Math.log10(Math.max(0.001, volumeScale))

      // Resolve MIDI program override from pizz./arco (per-part, best-effort)
      const effectiveMidi = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
      // Pizz. approximation: shorter envelope (plucked feel)
      const isPizz = effectiveMidi === 45

      for (const event of measure.voices[0]?.events ?? []) {
        const dur = eventToSeconds(event, effectiveBpm)
        const t   = partCursor.t

        if (event.type === 'note') {
          const n   = event as Note
          const hz  = pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
          const db  = volDb
          const plucked = isPizz
          Tone.Transport.schedule((time) => {
            synth.set({ envelope: plucked
              ? { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 }
              : { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 } })
            synth.volume.value = db
            synth.triggerAttackRelease(hz, dur, time)
          }, t)
        } else if (event.type === 'chord') {
          const c      = event as Chord
          const freqs  = c.pitches.map(p => pitchToHz(p.noteName, p.octave, p.accidental, part.transposeSemitones))
          const db     = volDb
          const plucked = isPizz
          Tone.Transport.schedule((time) => {
            synth.set({ envelope: plucked
              ? { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 }
              : { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.1 } })
            synth.volume.value = db
            freqs.forEach(hz => synth.triggerAttackRelease(hz, dur, time))
          }, t)
        }
        // rests: advance cursor only

        partCursor.t += dur
      }
    }

    cursor = Math.max(cursor, partCursor.t)
  }

  let stopped = false

  // Fire onStop after all note release tails have finished
  Tone.Transport.schedule(() => {
    if (!stopped) {
      stopped = true
      Tone.Transport.stop()
      Tone.Transport.cancel()
      setTimeout(() => synth.dispose(), 300)
      onStop?.()
    }
  }, cursor + 0.3)

  Tone.Transport.start()

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
  }
}
