'use client';

import { cn } from '@/shared/lib/cn';

export interface FieldProps {
  id: string;
  label: string;
  type: 'number' | 'text' | 'select';
  options?: string[];
  required?: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
}

/**
 * A generic input driven by a field descriptor.
 *
 * The assessment questions arrive from the API as data, so the form is
 * rendered from that data rather than hand-written — otherwise changing the
 * funnel would need a frontend deploy, defeating the point of serving the
 * questions from the backend at all.
 */
export function Field({
  id,
  label,
  type,
  options,
  required,
  value,
  onChange,
  className,
}: FieldProps) {
  const control = cn(
    'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5',
    'text-body text-ink transition-colors duration-200 ease-editorial',
    'placeholder:text-muted hover:border-hairline/30 focus:border-ink/50',
  );

  return (
    <div className={className}>
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-muted">*</span> : null}
      </label>

      {type === 'select' && options ? (
        <select
          id={id}
          className={control}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          className={control}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(event) =>
            // Coerce here so the API receives a number, not "62". The backend
            // validates too, but sending the right type avoids a round trip.
            onChange(type === 'number' ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </div>
  );
}
