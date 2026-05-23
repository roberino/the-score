import * as Tone from 'tone'
import type { Score, Note, Chord, Hairpin } from '@shared/score'
import { resolveDirectiveDynamic, resolveDirectiveTempo, resolveKeySig, resolveTimeSig, measureCapacityUnits, buildPlaybackSequence, buildFlatSchedule, articulationPlaybackMods, expandOrnamentNotes, type FlatScheduleEntry } from '@shared/musicUtils'
import { type PlaybackController } from './audioEngine'
import { midiService } from '../services/midiService'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEMITONES_FROM_C: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

export function pitchToMidi(
  noteName: string,
  octave: number,
  accidental: string | null | undefined,
  transposeSemitones = 0,
): number {
  let semi = SEMITONES_FROM_C[noteName] ?? 0
  if (accidental === 'sharp')       semi += 1
  else if (accidental === 'flat')   semi -= 1
  else if (accidental === 'doubleSharp') semi += 2
  else if (accidental === 'doubleFlat')  semi -= 2
  return Math.max(0, Math.min(127, (octave + 1) * 12 + semi - transposeSemitones))
}

function velocityFromDb(db: number): number {
  return Math.max(1, Math.min(127, Math.round(Math.pow(10, db / 20) * 100)))
}

// Returns a map of eventId → velocity multiplier (0.5–1.0) for hairpin ramps.
function buildHairpinFactorMap(
  hairpins: readonly Hairpin[] | undefined,
  schedule: FlatScheduleEntry[],
): Map<string, number> {
  const map = new Map<string, number>()
  if (!hairpins?.length) return map
  const START = 0.5, END = 1.0
  for (const hairpin of hairpins) {
    const fromIdx = schedule.findIndex(fe => fe.event.id === hairpin.fromNoteId)
    const toIdx   = schedule.findIndex(fe => fe.event.id === hairpin.toNoteId)
    if (fromIdx === -1 || toIdx === -1) continue
    const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx)
    for (let i = lo; i <= hi; i++) {
      const t = hi > lo ? (i - lo) / (hi - lo) : 0
      map.set(schedule[i].event.id,
        hairpin.type === 'crescendo' ? START + (END - START) * t : END - (END - START) * t)
    }
  }
  return map
}

function parseSysexHex(hex: string): Uint8Array | null {
  const bytes = hex.trim().split(/\s+/).map(b => parseInt(b, 16))
  if (bytes.some(n => isNaN(n) || n < 0 || n > 255)) return null
  return new Uint8Array(bytes)
}

// ── MIDI Output Engine ────────────────────────────────────────────────────────

export interface MidiOutputInfo {
  id:   string
  name: string
}

class MidiOutputEngine {
  private access:   MIDIAccess | null = null
  private _output:  MIDIOutput | null = null
  private _connected = false

  get connected(): boolean { return this._connected }

  get outputInfos(): MidiOutputInfo[] {
    if (!this.access) return []
    return Array.from(this.access.outputs.values()).map(o => ({
      id:   o.id,
      name: o.name ?? 'Unknown',
    }))
  }

  async init(): Promise<boolean> {
    if (this.access) return true
    if (!navigator.requestMIDIAccess) return false
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true })
      this.access.onstatechange = () => {
        if (this._output && !this.access!.outputs.has(this._output.id)) {
          this._output    = null
          this._connected = false
        }
      }
      return true
    } catch {
      return false
    }
  }

  async selectOutput(deviceId: string): Promise<boolean> {
    await this.init()
    if (!this.access) return false
    const output = this.access.outputs.get(deviceId)
    if (!output) return false
    this._output    = output
    this._connected = true
    midiService.setOutputFilter(output.name ?? null)
    return true
  }

  deselect(): void {
    this.allNotesOff()
    this._output    = null
    this._connected = false
    midiService.setOutputFilter(null)
  }

  allNotesOff(): void {
    if (!this._output) return
    for (let ch = 0; ch < 16; ch++) {
      this._output.send([0xB0 | ch, 123, 0])  // All Notes Off
      this._output.send([0xB0 | ch, 120, 0])  // All Sound Off
    }
  }

  previewNote(midiNote: number, velocity: number, durationMs = 400): void {
    if (!this._output) return
    this._output.send([0x90, midiNote, velocity])
    const out = this._output
    setTimeout(() => out.send([0x80, midiNote, 0]), durationMs)
  }

  async playScore(
    score: Score,
    bpm = 120,
    onStop?: () => void,
  ): Promise<PlaybackController> {
    const output = this._output
    if (!output) {
      onStop?.()
      return { stop: () => {} }
    }

    await Tone.start()

    Tone.Transport.stop()
    Tone.Transport.cancel()
    Tone.Transport.bpm.value = bpm

    const perfAudioOffset = performance.now() - Tone.now() * 1000

    let totalDuration = 0
    const tempoStaff = score.parts[0]?.staves[0]
    const sequence   = buildPlaybackSequence(tempoStaff?.measures ?? [], score.voltas ?? [])

    score.parts.forEach((part, partIdx) => {
      if (part.muted) return
      const staff = part.staves[0]
      if (!staff || !tempoStaff) return

      // midiChannel is 1-based (1–16); fall back to partIndex+1 for old scores
      const channel = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)

      const pgm = Math.max(0, Math.min(127, part.midiProgram - 1))
      Tone.Transport.schedule((time) => {
        const ts = perfAudioOffset + time * 1000
        output.send([0xC0 | channel, pgm], ts)
      }, 0)

      const schedule       = buildFlatSchedule(staff, sequence, tempoStaff, bpm, score.timeSignature)
      const hairpinFactors = buildHairpinFactorMap(staff.hairpins, schedule)

      for (const fe of schedule) {
        if (fe.skip) continue
        const { event, mIdx, startSec, playDurSec } = fe

        const dynMultiplier  = resolveDirectiveDynamic(staff.measures, mIdx)
        const volumeScale    = dynMultiplier ?? part.volume
        const volDb          = 20 * Math.log10(Math.max(0.001, volumeScale))
        const hairpinFactor  = hairpinFactors.get(event.id) ?? 1.0

        const keySig     = resolveKeySig(staff.measures, mIdx, score.keySignature)
        const bpmAtEvent = resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
        const ornNotes   = expandOrnamentNotes(event, startSec, playDurSec, bpmAtEvent, keySig)
        if (ornNotes) {
          const baseVel = Math.max(1, Math.min(127, Math.round(velocityFromDb(volDb) * hairpinFactor)))
          for (const on of ornNotes) {
            const midiNum   = pitchToMidi(on.noteName, on.octave, on.accidental, part.transposeSemitones)
            const noteOffMs = Math.max(20, on.durSec * 1000 - 20)
            Tone.Transport.schedule((time) => {
              const ts = perfAudioOffset + time * 1000
              output.send([0x90 | channel, midiNum, baseVel], ts)
              output.send([0x80 | channel, midiNum, 0], ts + noteOffMs)
            }, on.startSec)
          }
          continue
        }

        const { durFactor, velFactor } = articulationPlaybackMods(event)
        const velocity  = Math.max(1, Math.min(127, Math.round(velocityFromDb(volDb) * velFactor * hairpinFactor)))
        const noteOffMs = Math.max(50, playDurSec * durFactor * 1000 - 30)

        if (event.type === 'note') {
          const n       = event as Note
          const midiNum = pitchToMidi(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, part.transposeSemitones)
          Tone.Transport.schedule((time) => {
            const ts = perfAudioOffset + time * 1000
            output.send([0x90 | channel, midiNum, velocity], ts)
            output.send([0x80 | channel, midiNum, 0], ts + noteOffMs)
          }, startSec)
        } else if (event.type === 'chord') {
          const midiNums = (event as Chord).pitches.map(
            p => pitchToMidi(p.noteName, p.octave, p.accidental, part.transposeSemitones)
          )
          Tone.Transport.schedule((time) => {
            const ts = perfAudioOffset + time * 1000
            midiNums.forEach(n => {
              output.send([0x90 | channel, n, velocity], ts)
              output.send([0x80 | channel, n, 0], ts + noteOffMs)
            })
          }, startSec)
        }
      }

      if (schedule.length > 0) {
        const last = schedule[schedule.length - 1]
        totalDuration = Math.max(totalDuration, last.startSec + last.playDurSec)
      }

      // Schedule MIDI score events at their beat-precise positions
      let midiT = 0
      for (const mIdx of sequence) {
        const measure     = staff.measures[mIdx]
        if (!measure) continue
        const localBpm    = resolveDirectiveTempo(tempoStaff.measures, mIdx, bpm)
        const timeSig     = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
        const measDurSec  = (measureCapacityUnits(timeSig) / 16) * (60 / localBpm)
        const measStartT  = midiT

        for (const me of measure.midiEvents ?? []) {
          const eventT = measStartT + (me.beatPosition / 16) * (60 / localBpm)
          Tone.Transport.schedule((time) => {
            const ts = perfAudioOffset + time * 1000
            switch (me.type) {
              case 'cc':
                output.send([0xB0 | channel, me.cc!.controller, me.cc!.value], ts)
                break
              case 'pc':
                output.send([0xC0 | channel, me.pc!.program], ts)
                break
              case 'pb': {
                const v = me.pb!.value + 8192
                output.send([0xE0 | channel, v & 0x7F, (v >> 7) & 0x7F], ts)
                break
              }
              case 'sysex': {
                const bytes = parseSysexHex(me.sysex!.hex)
                if (bytes) output.send(bytes, ts)
                break
              }
            }
          }, eventT)
        }

        midiT = measStartT + measDurSec
      }
    })

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
    }, totalDuration + 0.3)

    Tone.Transport.start()

    return {
      stop() {
        if (stopped) return
        stopped = true
        Tone.Transport.stop()
        Tone.Transport.cancel()
        for (let ch = 0; ch < 16; ch++) {
          output.send([0xB0 | ch, 123, 0])
        }
        onStop?.()
      },
    }
  }
}

export const midiOutputEngine = new MidiOutputEngine()
