import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { midiService } from '../services/midiService'
import type { MidiLearnFunctionId, MidiLearnBinding } from '../store/appStore'
import type { MidiControlInput } from '../services/midiService'

const LEARN_TIMEOUT_MS = 10_000

export function useMidiLearn(): void {
  const midiLearnListening = useAppStore(s => s.midiLearnListening)
  const stopMidiLearnListening = useAppStore(s => s.stopMidiLearnListening)
  const setMidiLearnBinding    = useAppStore(s => s.setMidiLearnBinding)
  const midiLearnBindings      = useAppStore(s => s.midiLearnBindings)
  const cycleDuration          = useAppStore(s => s.cycleDuration)

  // Stable refs so the one-time subscription always uses latest values
  const listeningRef   = useRef(midiLearnListening)
  const bindingsRef    = useRef(midiLearnBindings)
  const stopRef        = useRef(stopMidiLearnListening)
  const setBindingRef  = useRef(setMidiLearnBinding)
  const cycleRef       = useRef(cycleDuration)

  useEffect(() => { listeningRef.current  = midiLearnListening },      [midiLearnListening])
  useEffect(() => { bindingsRef.current   = midiLearnBindings },        [midiLearnBindings])
  useEffect(() => { stopRef.current       = stopMidiLearnListening },   [stopMidiLearnListening])
  useEffect(() => { setBindingRef.current = setMidiLearnBinding },      [setMidiLearnBinding])
  useEffect(() => { cycleRef.current      = cycleDuration },            [cycleDuration])

  // Single stable CC subscription — handles both learn capture and runtime dispatch
  useEffect(() => {
    return midiService.subscribeControl((input: MidiControlInput) => {
      const listening = listeningRef.current
      if (listening) {
        // Capture the binding
        const binding: MidiLearnBinding = { type: 'cc', channel: input.channel, number: input.number }
        setBindingRef.current(listening, binding)
        stopRef.current()
        return
      }
      // Runtime dispatch — check stored bindings
      const bindings = bindingsRef.current
      for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
        if (binding.type === 'cc' && binding.channel === input.channel && binding.number === input.number) {
          if (fnId === 'durationCycle') cycleRef.current()
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
