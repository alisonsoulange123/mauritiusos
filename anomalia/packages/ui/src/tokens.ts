/** Shared vocabulary so every component's props mean the same thing. */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

/** Confidence bands from the AI blueprint §17, as a UI concern. */
export const confidenceTone = (confidence: number): Tone => {
  if (confidence >= 0.9) return 'success';
  if (confidence >= 0.5) return 'warning';
  return 'danger';
};
