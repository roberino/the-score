import { useEffect, useState } from 'react'
import { midiService, type NoteInputHandler, type MidiInputInfo } from '../services/midiService'
import { useAppStore } from '../store/appStore'

export function useMidiInput(handler: NoteInputHandler | null): { connected: boolean; inputInfos: MidiInputInfo[] } {
  const [connected,  setConnected]  = useState(false)
  const [inputInfos, setInputInfos] = useState<MidiInputInfo[]>([])
  const setMidiInputDevice = useAppStore(s => s.setMidiInputDevice)

  useEffect(() => {
    let unsub: (() => void) | null = null

    midiService.connect().then(ok => {
      setConnected(ok)
      setInputInfos(midiService.inputInfos)
      // Restore saved input selection (service wasn't connected when store initialised)
      const savedId   = useAppStore.getState().midiInputDeviceId
      const savedName = useAppStore.getState().midiInputDeviceName
      if (savedId) {
        const found = midiService.inputInfos.find(i => i.id === savedId)
        if (found) midiService.selectInput(savedId)
        else       setMidiInputDevice(null, null)  // device no longer present
      } else if (savedId !== null) {
        // ID was set to something, but we couldn't resolve — clear
        setMidiInputDevice(null, null)
      }
      void savedName  // used indirectly via localStorage init in store
    })

    if (handler) {
      unsub = midiService.subscribe(handler)
    }

    midiService.onInputDisconnected(() => {
      setInputInfos(midiService.inputInfos)
      setMidiInputDevice(null, null)
    })

    return () => {
      unsub?.()
      midiService.onInputDisconnected(null)
    }
  }, [handler, setMidiInputDevice])

  return { connected, inputInfos }
}
