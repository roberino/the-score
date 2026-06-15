// ─────────────────────────────────────────────────────────────────────────────
// Drum sampler engine
//
// Plays GM percussion notes (35–81) using bundled samples (Tone.Players) with
// a synthesised Web Audio fallback for notes not in the sample set or when
// samples haven't finished loading.
// ─────────────────────────────────────────────────────────────────────────────

import * as Tone from 'tone'
import { DRUM_MAP } from '@shared/drumMap'

// ── Sample map: MIDI note → bundled file ──────────────────────────────────────

// Derived from DRUM_MAP so coverage stays in sync automatically.
// Notes with no sample file fall through to the synthesised fallback.
const DRUM_SAMPLE_NOTES: readonly number[] = DRUM_MAP.map(d => d.midiNote)

function sampleUrl(note: number): string {
  return `./samples/drums/${note}.mp3`
}

// ── Singleton Tone.Players ────────────────────────────────────────────────────

let _players: Tone.Players | null = null
let _ready = false
let _loadPromise: Promise<void> | null = null

export function loadDrumSampler(): Promise<void> {
  if (_loadPromise) return _loadPromise

  _loadPromise = new Promise<void>((resolve) => {
    const urls: Record<string, string> = {}
    for (const note of DRUM_SAMPLE_NOTES) {
      urls[String(note)] = sampleUrl(note)
    }
    _players = new Tone.Players({
      urls,
      onload: () => { _ready = true; resolve() },
      onerror: () => {
        // Samples failed to load — mark ready so fallback is used without error
        _ready = true
        resolve()
      },
    }).toDestination()
  })

  return _loadPromise
}

export function isDrumSamplerReady(): boolean {
  return _ready
}

export function releaseDrumSampler(): void {
  // Players self-manage their voices; nothing to release explicitly.
  // Called on playback stop so future implementations can clean up.
}

// ── Fallback — synthesised drum hits ─────────────────────────────────────────

type DrumCategory =
  | 'kick' | 'snare' | 'rimshot' | 'hihat-closed' | 'hihat-open'
  | 'tom-low' | 'tom-mid' | 'tom-high' | 'crash' | 'ride' | 'clap' | 'default'

function categorise(note: number): DrumCategory {
  if (note === 35 || note === 36)                 return 'kick'
  if (note === 38 || note === 40)                 return 'snare'
  if (note === 37)                                return 'rimshot'
  if (note === 39)                                return 'clap'
  if (note === 42 || note === 44)                 return 'hihat-closed'
  if (note === 46)                                return 'hihat-open'
  if (note === 41 || note === 43)                 return 'tom-low'
  if (note === 45 || note === 47)                 return 'tom-mid'
  if (note === 48 || note === 50)                 return 'tom-high'
  if (note === 49 || note === 52 || note === 57)  return 'crash'
  if (note === 51 || note === 53 || note === 59)  return 'ride'
  return 'default'
}

function synthHit(note: number, gainDb: number, time: number, ctx: AudioContext): void {
  const cat = categorise(note)
  const gain = ctx.createGain()
  gain.gain.value = Math.pow(10, gainDb / 20) * 0.8
  gain.connect(ctx.destination)

  const t = time

  switch (cat) {
    case 'kick': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(120, t)
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.2)
      const env = ctx.createGain()
      env.gain.setValueAtTime(1, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      osc.connect(env); env.connect(gain)
      osc.start(t); osc.stop(t + 0.26)
      break
    }
    case 'snare': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.15)
      const bpf = ctx.createBiquadFilter()
      bpf.type = 'bandpass'; bpf.frequency.value = 400; bpf.Q.value = 0.8
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.8, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      noise.connect(bpf); bpf.connect(env); env.connect(gain)
      const tone = ctx.createOscillator()
      tone.type = 'triangle'; tone.frequency.value = 180
      const toneEnv = ctx.createGain()
      toneEnv.gain.setValueAtTime(0.3, t)
      toneEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
      tone.connect(toneEnv); toneEnv.connect(gain)
      noise.start(t); tone.start(t); noise.stop(t + 0.16); tone.stop(t + 0.07)
      break
    }
    case 'rimshot': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.05)
      const bpf = ctx.createBiquadFilter()
      bpf.type = 'bandpass'; bpf.frequency.value = 1800; bpf.Q.value = 1.5
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.7, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      noise.connect(bpf); bpf.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.05)
      break
    }
    case 'clap': {
      for (let i = 0; i < 3; i++) {
        const offset = i * 0.012
        const noise = ctx.createBufferSource()
        noise.buffer = whiteNoise(ctx, 0.07)
        const bpf = ctx.createBiquadFilter()
        bpf.type = 'bandpass'; bpf.frequency.value = 1200; bpf.Q.value = 0.7
        const env = ctx.createGain()
        env.gain.setValueAtTime(0.6, t + offset)
        env.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.06)
        noise.connect(bpf); bpf.connect(env); env.connect(gain)
        noise.start(t + offset); noise.stop(t + offset + 0.07)
      }
      break
    }
    case 'hihat-closed': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.05)
      const hpf = ctx.createBiquadFilter()
      hpf.type = 'highpass'; hpf.frequency.value = 8000
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.6, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      noise.connect(hpf); hpf.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.05)
      break
    }
    case 'hihat-open': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.35)
      const hpf = ctx.createBiquadFilter()
      hpf.type = 'highpass'; hpf.frequency.value = 7000
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.5, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      noise.connect(hpf); hpf.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.36)
      break
    }
    case 'tom-low': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.setValueAtTime(90, t)
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.2)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.9, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      osc.connect(env); env.connect(gain)
      osc.start(t); osc.stop(t + 0.23)
      break
    }
    case 'tom-mid': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.setValueAtTime(130, t)
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.18)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.9, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      osc.connect(env); env.connect(gain)
      osc.start(t); osc.stop(t + 0.21)
      break
    }
    case 'tom-high': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.setValueAtTime(180, t)
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.15)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.9, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.17)
      osc.connect(env); env.connect(gain)
      osc.start(t); osc.stop(t + 0.18)
      break
    }
    case 'crash': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.9)
      const peak = ctx.createBiquadFilter()
      peak.type = 'peaking'; peak.frequency.value = 8000; peak.gain.value = 10; peak.Q.value = 0.5
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.7, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.85)
      noise.connect(peak); peak.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.9)
      break
    }
    case 'ride': {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.45)
      const bpf = ctx.createBiquadFilter()
      bpf.type = 'bandpass'; bpf.frequency.value = 5000; bpf.Q.value = 0.6
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.5, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
      noise.connect(bpf); bpf.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.45)
      break
    }
    default: {
      const noise = ctx.createBufferSource()
      noise.buffer = whiteNoise(ctx, 0.09)
      const bpf = ctx.createBiquadFilter()
      bpf.type = 'bandpass'; bpf.frequency.value = 800; bpf.Q.value = 1
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.5, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
      noise.connect(bpf); bpf.connect(env); env.connect(gain)
      noise.start(t); noise.stop(t + 0.09)
      break
    }
  }
}

// Shared white-noise buffer cache keyed by duration (seconds, 2-decimal precision)
const _noiseCache = new Map<string, AudioBuffer>()

function whiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const key = `${ctx.sampleRate}-${durationSec.toFixed(2)}`
  if (_noiseCache.has(key)) return _noiseCache.get(key)!
  const length = Math.ceil(ctx.sampleRate * durationSec)
  const buf    = ctx.createBuffer(1, length, ctx.sampleRate)
  const data   = buf.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  _noiseCache.set(key, buf)
  return buf
}

// ── Public scheduling API ─────────────────────────────────────────────────────

export function scheduleDrumHit(
  midiNote: number,
  velocity: number,
  volumeDb: number,
  time: number,
): void {
  const gainDb = volumeDb + 20 * Math.log10(Math.max(0.001, velocity))

  if (_ready && _players && DRUM_SAMPLE_NOTES.includes(midiNote)) {
    try {
      const player = _players.player(String(midiNote))
      if (player.loaded) {
        player.volume.value = gainDb
        player.start(time)
        return
      }
    } catch {
      // fall through to synthesis
    }
  }

  // Synthesised fallback — time is already an AudioContext time from Transport callback
  const rawCtx = Tone.getContext().rawContext as AudioContext
  synthHit(midiNote, gainDb, time, rawCtx)
}

export function previewDrumHit(midiNote: number, volumeDb: number): void {
  if (_ready && _players && DRUM_SAMPLE_NOTES.includes(midiNote)) {
    try {
      const player = _players.player(String(midiNote))
      if (player.loaded) {
        player.volume.value = volumeDb
        player.start(Tone.now())
        return
      }
    } catch {
      // fall through to synthesis
    }
  }

  const rawCtx = Tone.getContext().rawContext as AudioContext
  synthHit(midiNote, volumeDb, rawCtx.currentTime + 0.01, rawCtx)
}
