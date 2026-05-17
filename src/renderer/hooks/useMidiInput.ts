import { useEffect, useState } from 'react'
import { midiService, type NoteInputHandler } from '../services/midiService'

export function useMidiInput(handler: NoteInputHandler | null): { connected: boolean; inputNames: string[] } {
  const [connected,  setConnected]  = useState(false)
  const [inputNames, setInputNames] = useState<string[]>([])

  useEffect(() => {
    let unsub: (() => void) | null = null

    midiService.connect().then(ok => {
      setConnected(ok)
      setInputNames(midiService.inputNames)
    })

    if (handler) {
      unsub = midiService.subscribe(handler)
    }

    return () => {
      unsub?.()
    }
  }, [handler])

  return { connected, inputNames }
}
