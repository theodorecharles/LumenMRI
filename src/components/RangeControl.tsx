import type { CSSProperties } from 'react'

interface RangeControlProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  displayValue?: string
  onChange: (value: number) => void
}

export function RangeControl({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  displayValue,
  onChange,
}: RangeControlProps) {
  const progress = ((value - min) / (max - min)) * 100
  const style = { '--range-progress': `${progress}%` } as CSSProperties

  return (
    <label className="range-control">
      <span>
        <b>{label}</b>
        <output>{displayValue ?? Math.round(value * 100)}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={style}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
