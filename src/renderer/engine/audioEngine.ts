// ─────────────────────────────────────────────────────────────────────────────
// Audio playback engine — Web Audio API, no external dependencies.
// Schedules all notes up-front using AudioContext.currentTime for sample-
// accurate timing. Returns a controller with a stop() method.
// ─────────────────────────────────────────────────────────────────────────────

import type { Score, Note, Chord, NoteEvent } from '@shared/score'

// ── Pitch → frequency ────────────────────────────────────────────────────────

const SEMITONES_FROM_C: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

function pitchToHz(noteName: string, octave: number, accidental: string | null): number {
  let semi = SEMITONES_FROM_C[noteName] ?? 0
  if (accidental === 'sharp')        semi += 1
  else if (accidental === 'flat')    semi -= 1
  else if (accidental === 'doubleSharp') semi += 2
  else if (accidental === 'doubleFlat')  semi -= 2
  // MIDI: C4 = 60, A4 = 69 = 440 Hz
  const midi = (octave + 1) * 12 + semi
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ── Duration → seconds ───────────────────────────────────────────────────────

const DURATION_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}

function eventToSeconds(event: NoteEvent, bpm: number): number {
  const beats = DURATION_BEATS[event.duration] ?? 1
  const dotted = event.dots === 2 ? beats * 1.75 : event.dots === 1 ? beats * 1.5 : beats
  return dotted * (60 / bpm)
}

// ── Single note scheduler ────────────────────────────────────────────────────

function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  hz: number,
  startTime: number,
  duration: number,
): void {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = hz
  osc.connect(gain)
  gain.connect(dest)

  const attack  = 0.005
  const release = Math.min(0.08, duration * 0.25)
  const hold    = Math.max(duration - attack - release, 0.001)

  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(0.6, startTime + attack)
  gain.gain.setValueAtTime(0.6, startTime + attack + hold)
  gain.gain.linearRampToValueAtTime(0, startTime + attack + hold + release)

  osc.start(startTime)
  osc.stop(startTime + duration + 0.05)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PlaybackController {
  stop: () => void
}

export function playScore(
  score: Score,
  bpm = 120,
  onStop?: () => void,
): PlaybackController {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = 0.7
  master.connect(ctx.destination)

  let cursor = 0  // seconds offset from ctx.currentTime

  const firstStaff = score.parts[0]?.staves[0]
  if (firstStaff) {
    for (const measure of firstStaff.measures) {
      for (const event of measure.voices[0]?.events ?? []) {
        const dur = eventToSeconds(event, bpm)
        const t   = ctx.currentTime + cursor
        if (event.type === 'note') {
          const n = event as Note
          scheduleNote(ctx, master, pitchToHz(n.pitch.noteName, n.pitch.octave, n.pitch.accidental), t, dur)
        } else if (event.type === 'chord') {
          const c = event as Chord
          for (const p of c.pitches) {
            scheduleNote(ctx, master, pitchToHz(p.noteName, p.octave, p.accidental), t, dur)
          }
        }
        // rests: silence — just advance cursor
        cursor += dur
      }
    }
  }

  let stopped = false
  const endTimer = window.setTimeout(() => {
    if (!stopped) { stopped = true; void ctx.close(); onStop?.() }
  }, cursor * 1000 + 300)

  return {
    stop() {
      if (stopped) return
      stopped = true
      clearTimeout(endTimer)
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
      window.setTimeout(() => void ctx.close(), 200)
      onStop?.()
    },
  }
}
