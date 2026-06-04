import { useState, useCallback } from 'react'

interface VolumeSliderProps {
  value: number          // 0–1
  onChange: (v: number) => void
  style?: React.CSSProperties
}

/**
 * Range slider that shows local feedback while dragging but only calls
 * onChange on pointer-up, avoiding continuous audio disruption.
 */
export function VolumeSlider({ value, onChange, style }: VolumeSliderProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [localValue, setLocalValue] = useState(0)

  const displayPct = dragging ? localValue : Math.round(value * 100)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(Number(e.target.value))
  }, [])

  const handlePointerDown = useCallback(() => {
    setLocalValue(Math.round(value * 100))
    setDragging(true)
  }, [value])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
    setDragging(false)
    onChange(Number((e.target as HTMLInputElement).value) / 100)
  }, [onChange])

  return (
    <input
      type="range" min={0} max={100} step={1}
      value={displayPct}
      onChange={handleChange}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ accentColor: '#0e639c', cursor: 'pointer', ...style }}
    />
  )
}
