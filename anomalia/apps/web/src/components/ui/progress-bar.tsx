import { cn } from '@/shared/lib/cn';

/** A 2px rule that fills. The thinnest thing that still reads as progress. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn('h-[2px] w-full overflow-hidden bg-hairline/[0.12]', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-ink transition-[width] duration-500 ease-editorial"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
