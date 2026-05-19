import { useEffect, useRef, useState } from 'react'
import { midiService, type NoteInputHandler, type MidiInputInfo } from '../services/midiService'
import { useAppStore } from '../store/appStore'

export function useMidiInput(handler: NoteInputHandler | null): { connected: boolean; inputInfos: MidiInputInfo[] } {
  const [connected,  setConnected]  = useState(false)
  const [inputInfos, setInputInfos] = useState<MidiInputInfo[]>([])

  // Keep a ref to the latest handler so the stable subscription always calls
  // the current version without needing to re-subscribe on every render.
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler }, [handler])

  // Keep a ref to setMidiInputDevice so the one-time effect can call it later.
  const setMidiInputDevice = useAppStore(s => s.setMidiInputDevice)
  const setMidiInputDeviceRef = useRef(setMidiInputDevice)
  useEffect(() => { setMidiInputDeviceRef.current = setMidiInputDevice }, [setMidiInputDevice])

  useEffect(() => {
    // Stable subscription — never re-registered, always calls the current handler ref.
    const stableHandler: NoteInputHandler = (input) => handlerRef.current?.(input)
    const unsub = midiService.subscribe(stableHandler)

    midiService.connect().then(ok => {
      setConnected(ok)
      setInputInfos(midiService.inputInfos)
      // Restore saved input selection (service wasn't connected when store initialised)
      const savedId = useAppStore.getState().midiInputDeviceId
      if (savedId) {
        const found = midiService.inputInfos.find(i => i.id === savedId)
        if (found) midiService.selectInput(savedId)
        else       setMidiInputDeviceRef.current(null, null)
      }
    })

    midiService.onInputDisconnected(() => {
      setInputInfos(midiService.inputInfos)
      setMidiInputDeviceRef.current(null, null)
    })

    return () => {
      unsub()
      midiService.onInputDisconnected(null)
    }
  }, []) // empty deps — subscribe once, use refs for latest callbacks

  return { connected, inputInfos }
}
