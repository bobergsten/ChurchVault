import { useState } from 'react'
import { DEFAULT_PASSWORD_OPTIONS, generatePassword, type PasswordOptions } from '@shared/password'

export function PasswordGenerator({ onUse, onClose }: { onUse: (password: string) => void; onClose: () => void }) {
  const [opts, setOpts] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const make = (o: PasswordOptions): string => {
    try { return generatePassword(o) } catch { return '' }
  }
  const [value, setValue] = useState(() => make(opts))
  const update = (patch: Partial<PasswordOptions>): void => {
    const next = { ...opts, ...patch }
    setOpts(next)
    setValue(make(next))
  }
  const toggles: [keyof PasswordOptions, string][] = [
    ['lower', 'a-z'], ['upper', 'A-Z'], ['digits', '0-9'], ['symbols', '!@#'], ['avoidAmbiguous', 'No look-alikes']
  ]
  return (
    <div className="generator" role="dialog" aria-label="Password generator">
      <code className="generated">{value || 'Select at least one type'}</code>
      <label>Length: {opts.length}
        <input type="range" min={8} max={64} value={opts.length} onChange={(e) => update({ length: Number(e.target.value) })} />
      </label>
      <div className="row wrap">
        {toggles.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={opts[k] as boolean} onChange={(e) => update({ [k]: e.target.checked })} />{label}
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" onClick={() => setValue(make(opts))}>Regenerate</button>
        <button type="button" className="primary" disabled={!value} onClick={() => onUse(value)}>Use this</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
