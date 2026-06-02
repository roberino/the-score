import { useEffect, useRef } from 'react'
import { useAppStore, DURATION_CYCLE } from '../store/appStore'
import { midiService } from '../services/midiService'
import type { MidiLearnFunctionId, MidiLearnBinding } from '../store/appStore'
import type { MidiControlInput } from '../services/midiService'

const LEARN_TIMEOUT_MS = 10_000

export function useMidiLearn(): void {
  const midiLearnListening     = useAppStore(s => s.midiLearnListening)
  const stopMidiLearnListening = useAppStore(s => s.stopMidiLearnListening)
  const setMidiLearnBinding    = useAppStore(s => s.setMidiLearnBinding)
  const midiLearnBindings      = useAppStore(s => s.midiLearnBindings)
  const setSelectedDuration    = useAppStore(s => s.setSelectedDuration)

  // Stable refs so the one-time subscription always uses latest values
  const listeningRef        = useRef(midiLearnListening)
  const bindingsRef         = useRef(midiLearnBindings)
  const stopRef             = useRef(stopMidiLearnListening)
  const setBindingRef       = useRef(setMidiLearnBinding)
  const setDurationRef      = useRef(setSelectedDuration)

  useEffect(() => { listeningRef.current   = midiLearnListening },      [midiLearnListening])
  useEffect(() => { bindingsRef.current    = midiLearnBindings },        [midiLearnBindings])
  useEffect(() => { stopRef.current        = stopMidiLearnListening },   [stopMidiLearnListening])
  useEffect(() => { setBindingRef.current  = setMidiLearnBinding },      [setMidiLearnBinding])
  useEffect(() => { setDurationRef.current = setSelectedDuration },      [setSelectedDuration])

  // Single stable CC subscription — handles both learn capture and runtime dispatch
  useEffect(() => {
    return midiService.subscribeControl((input: MidiControlInput) => {
      const listening = listeningRef.current
      if (listening) {
        const binding: MidiLearnBinding = { type: 'cc', channel: input.channel, number: input.number }
        setBindingRef.current(listening, binding)
        stopRef.current()
        return
      }
      // Runtime dispatch — check stored bindings
      const bindings = bindingsRef.current
      for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
        if (binding.type === 'cc' && binding.channel === input.channel && binding.number === input.number) {
          if (fnId === 'durationCycle') {
            // Map CC value (0–127) to one of 7 durations by dividing the range into
            // equal bands. Whole = low end, 64th = high end, matching the natural
            // feel of a physical knob (fully left = longest, fully right = shortest).
            const idx = Math.min(DURATION_CYCLE.length - 1, Math.floor((127 - input.value) * DURATION_CYCLE.length / 128))
            setDurationRef.current(DURATION_CYCLE[idx])
          }
          return
        }
      }
    })
  }, [])

  // 10-second timeout for listening state
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    if (!midiLearnListening) return
    timerRef.current = setTimeout(() => stopRef.current(), LEARN_TIMEOUT_MS)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [midiLearnListening])
}
