import { useEffect, useRef } from 'react'
import { useAppStore, MIDI_LEARN_FUNCTIONS } from '../store/appStore'
import { midiService } from '../services/midiService'
import type { MidiLearnFunctionId, MidiLearnBinding } from '../store/appStore'
import type { MidiControlInput } from '../services/midiService'
import { ccValueToDuration } from '@shared/musicUtils'
export { ccValueToDuration } from '@shared/musicUtils'

const LEARN_TIMEOUT_MS = 10_000

export function useMidiLearn(): void {
  const midiLearnListening     = useAppStore(s => s.midiLearnListening)
  const stopMidiLearnListening = useAppStore(s => s.stopMidiLearnListening)
  const setMidiLearnBinding    = useAppStore(s => s.setMidiLearnBinding)
  const setMidiLearnError      = useAppStore(s => s.setMidiLearnError)
  const midiLearnBindings      = useAppStore(s => s.midiLearnBindings)
  const setSelectedDuration    = useAppStore(s => s.setSelectedDuration)
  const moveCursorByDirection  = useAppStore(s => s.moveCursorByDirection)
  const deleteAtCursor         = useAppStore(s => s.deleteAtCursor)
  const toggleDot              = useAppStore(s => s.toggleDot)
  const inputMode              = useAppStore(s => s.inputMode)

  // Stable refs so the one-time subscription always uses latest values
  const listeningRef           = useRef(midiLearnListening)
  const bindingsRef            = useRef(midiLearnBindings)
  const stopRef                = useRef(stopMidiLearnListening)
  const setBindingRef          = useRef(setMidiLearnBinding)
  const setErrorRef            = useRef(setMidiLearnError)
  const setDurationRef         = useRef(setSelectedDuration)
  const moveCursorRef          = useRef(moveCursorByDirection)
  const deleteRef              = useRef(deleteAtCursor)
  const toggleDotRef           = useRef(toggleDot)
  const inputModeRef           = useRef(inputMode)

  useEffect(() => { listeningRef.current    = midiLearnListening },     [midiLearnListening])
  useEffect(() => { bindingsRef.current     = midiLearnBindings },       [midiLearnBindings])
  useEffect(() => { stopRef.current         = stopMidiLearnListening },  [stopMidiLearnListening])
  useEffect(() => { setBindingRef.current   = setMidiLearnBinding },     [setMidiLearnBinding])
  useEffect(() => { setErrorRef.current     = setMidiLearnError },       [setMidiLearnError])
  useEffect(() => { setDurationRef.current  = setSelectedDuration },     [setSelectedDuration])
  useEffect(() => { moveCursorRef.current   = moveCursorByDirection },   [moveCursorByDirection])
  useEffect(() => { deleteRef.current       = deleteAtCursor },          [deleteAtCursor])
  useEffect(() => { toggleDotRef.current    = toggleDot },               [toggleDot])
  useEffect(() => { inputModeRef.current    = inputMode },               [inputMode])

  // Single stable CC subscription — handles both learn capture and runtime dispatch
  useEffect(() => {
    return midiService.subscribeControl((input: MidiControlInput) => {
      const listening = listeningRef.current
      if (listening) {
        // Cross-function conflict: same CC already bound to a different function
        const bindings = bindingsRef.current
        const conflict = (Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][])
          .find(([id, b]) => b.type === 'cc' && b.channel === input.channel && b.number === input.number && id !== listening)
        if (conflict) {
          const conflictLabel = MIDI_LEARN_FUNCTIONS.find(f => f.id === conflict[0])?.label ?? conflict[0]
          setErrorRef.current(listening, `CC ${input.number} is already assigned to "${conflictLabel}". Clear that binding first.`)
          return
        }
        const binding: MidiLearnBinding = { type: 'cc', channel: input.channel, number: input.number }
        setBindingRef.current(listening, binding)
        stopRef.current()
        return
      }

      // Runtime dispatch — find matching binding and invoke the action
      const bindings = bindingsRef.current
      for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
        if (binding.type !== 'cc' || binding.channel !== input.channel || binding.number !== input.number) continue

        const mode = inputModeRef.current
        if (fnId === 'durationCycle') {
          setDurationRef.current(ccValueToDuration(input.value))
        } else if (fnId === 'cursorMove') {
          if (mode !== 'note' && mode !== 'rest') return
          if (input.value === 64) return
          moveCursorRef.current(input.value > 64 ? 'next' : 'prev')
        } else if (fnId === 'delete') {
          if (mode !== 'note' && mode !== 'rest') return
          deleteRef.current()
        } else if (fnId === 'dotToggle') {
          if (mode !== 'note' && mode !== 'rest' && mode !== 'select') return
          toggleDotRef.current()
        }
        return
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
