'use client';
import { useEffect, useId, useState } from 'react';
import { parameterError } from '@/lib/modeling/model';

export function NumberField({ label, value, onChange, minimum = -1e12, maximum = 1e12, hint, integer = false }: {
  label: string; value: number; onChange: (value: number) => void; minimum?: number; maximum?: number; hint?: string; integer?: boolean;
}) {
  const id = useId();
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { if (Number.isFinite(value)) setRaw(previous => Number(previous) === value && previous.trim() !== '' ? previous : String(value)); }, [value]);
  const error = parameterError(value, { minimum, maximum, type: integer ? 'integer' : 'number' });
  return <label className={`field ${error ? 'invalid' : ''}`} htmlFor={id}>
    <span>{label}</span>
    <input id={id} aria-label={label} type="text" inputMode="decimal" value={raw} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-hint` : undefined}
      onChange={e => { setRaw(e.target.value); onChange(e.target.value.trim() === '' ? NaN : Number(e.target.value)); }} />
    {(error || hint) && <small id={`${id}-hint`}>{error ?? hint}</small>}
  </label>;
}
