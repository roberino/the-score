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

  // Last CC value received per control, keyed by "channel:number".
  // Used to derive direction from delta for absolute encoders/knobs.
  const lastCCValueRef = useRef(new Map<string, number>())

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
        // Capture the binding and clear any stored delta baseline for this control
        const binding: MidiLearnBinding = { type: 'cc', channel: input.channel, number: input.number }
        setBindingRef.current(listening, binding)
        stopRef.current()
        lastCCValueRef.current.delete(`${input.channel}:${input.number}`)
        return
      }
      // Runtime dispatch — check stored bindings
      const bindings = bindingsRef.current
      for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
        if (binding.type === 'cc' && binding.channel === input.channel && binding.number === input.number) {
          if (fnId === 'durationCycle') {
            const key  = `${input.channel}:${input.number}`
            const last = lastCCValueRef.current.get(key)
            lastCCValueRef.current.set(key, input.value)

            let direction: 'forward' | 'backward'
            if (last !== undefined && input.value !== last) {
              // Delta available (absolute encoder / knob): direction from change.
              direction = input.value > last ? 'forward' : 'backward'
            } else {
              // No delta (first message, or relative encoder repeating same value):
              // fall back to midpoint heuristic — 65+ = forward, 63- = backward.
              if (input.value === 64) return  // dead zone
              direction = input.value > 64 ? 'forward' : 'backward'
            }
            cycleRef.current(direction)
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
