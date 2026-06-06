import { useEffect, useRef } from 'react'
import { useAppStore, MIDI_LEARN_FUNCTIONS } from '../store/appStore'
import { midiService, noteInputToMidi } from '../services/midiService'
import type { MidiLearnFunctionId, MidiLearnBinding } from '../store/appStore'
import type { MidiControlInput, NoteInput } from '../services/midiService'
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

  const listeningRef          = useRef(midiLearnListening)
  const bindingsRef           = useRef(midiLearnBindings)
  const stopRef               = useRef(stopMidiLearnListening)
  const setBindingRef         = useRef(setMidiLearnBinding)
  const setErrorRef           = useRef(setMidiLearnError)
  const setDurationRef        = useRef(setSelectedDuration)
  const moveCursorRef         = useRef(moveCursorByDirection)
  const deleteRef             = useRef(deleteAtCursor)
  const toggleDotRef          = useRef(toggleDot)
  const inputModeRef          = useRef(inputMode)

  useEffect(() => { listeningRef.current         = midiLearnListening },    [midiLearnListening])
  useEffect(() => { bindingsRef.current          = midiLearnBindings },      [midiLearnBindings])
  useEffect(() => { stopRef.current              = stopMidiLearnListening }, [stopMidiLearnListening])
  useEffect(() => { setBindingRef.current        = setMidiLearnBinding },    [setMidiLearnBinding])
  useEffect(() => { setErrorRef.current          = setMidiLearnError },      [setMidiLearnError])
  useEffect(() => { setDurationRef.current       = setSelectedDuration },    [setSelectedDuration])
  useEffect(() => { moveCursorRef.current        = moveCursorByDirection },  [moveCursorByDirection])
  useEffect(() => { deleteRef.current            = deleteAtCursor },         [deleteAtCursor])
  useEffect(() => { toggleDotRef.current         = toggleDot },              [toggleDot])
  useEffect(() => { inputModeRef.current         = inputMode },              [inputMode])

  // ── CC subscription (learn capture + runtime dispatch) ──────────────────────
  useEffect(() => {
    return midiService.subscribeControl((input: MidiControlInput) => {
      const listening = listeningRef.current
      if (listening) {
        const conflict = findConflict('cc', input.channel, input.number, listening)
        if (conflict) {
          const label = MIDI_LEARN_FUNCTIONS.find(f => f.id === conflict)?.label ?? conflict
          setErrorRef.current(listening, `CC ${input.number} is already assigned to "${label}". Clear that binding first.`)
          return
        }
        setBindingRef.current(listening, { type: 'cc', channel: input.channel, number: input.number })
        stopRef.current()
        return
      }
      dispatchCC(input)
    })
  }, [])

  // ── Note-on subscription (learn capture + runtime dispatch) ─────────────────
  useEffect(() => {
    return midiService.subscribe((input: NoteInput) => {
      const listening = listeningRef.current
      const midiNote  = noteInputToMidi(input)
      const channel   = input.channel ?? 0

      if (listening) {
        const fnDef = MIDI_LEARN_FUNCTIONS.find(f => f.id === listening)
        if (!fnDef?.acceptsKeyBinding) return // let ScoreCanvas show the type-mismatch error
        const conflict = findConflict('note', channel, midiNote, listening)
        if (conflict) {
          const label = MIDI_LEARN_FUNCTIONS.find(f => f.id === conflict)?.label ?? conflict
          setErrorRef.current(listening, `Note ${midiNote} is already assigned to "${label}". Clear that binding first.`)
          return
        }
        setBindingRef.current(listening, { type: 'note', channel, number: midiNote })
        stopRef.current()
        return
      }

      // Runtime: find a matching note binding and dispatch
      const bindings = bindingsRef.current
      for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
        if (binding.type !== 'note' || binding.channel !== channel || binding.number !== midiNote) continue
        dispatchKeyFn(fnId)
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function findConflict(
    type: 'cc' | 'note', channel: number, number: number, exclude: MidiLearnFunctionId,
  ): MidiLearnFunctionId | null {
    const bindings = bindingsRef.current
    for (const [id, b] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
      if (id !== exclude && b.type === type && b.channel === channel && b.number === number) return id
    }
    return null
  }

  function dispatchCC(input: MidiControlInput): void {
    const bindings = bindingsRef.current
    for (const [fnId, binding] of Object.entries(bindings) as [MidiLearnFunctionId, MidiLearnBinding][]) {
      if (binding.type !== 'cc' || binding.channel !== input.channel || binding.number !== input.number) continue
      const mode = inputModeRef.current
      if (fnId === 'durationCycle') {
        setDurationRef.current(ccValueToDuration(input.value))
      } else if (fnId === 'cursorLeft') {
        if (mode !== 'note' && mode !== 'rest') return
        if (input.value > 64) moveCursorRef.current('prev')
      } else if (fnId === 'cursorRight') {
        if (mode !== 'note' && mode !== 'rest') return
        if (input.value > 64) moveCursorRef.current('next')
      } else if (fnId === 'delete') {
        if (mode !== 'note' && mode !== 'rest') return
        deleteRef.current()
      } else if (fnId === 'dotToggle') {
        if (mode !== 'note' && mode !== 'rest' && mode !== 'select') return
        toggleDotRef.current()
      }
      return
    }
  }

  function dispatchKeyFn(fnId: MidiLearnFunctionId): void {
    const mode = inputModeRef.current
    if (fnId === 'cursorLeft') {
      if (mode !== 'note' && mode !== 'rest') return
      moveCursorRef.current('prev')
    } else if (fnId === 'cursorRight') {
      if (mode !== 'note' && mode !== 'rest') return
      moveCursorRef.current('next')
    } else if (fnId === 'delete') {
      if (mode !== 'note' && mode !== 'rest') return
      deleteRef.current()
    } else if (fnId === 'dotToggle') {
      if (mode !== 'note' && mode !== 'rest' && mode !== 'select') return
      toggleDotRef.current()
    }
  }
}
