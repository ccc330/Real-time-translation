export const SEGMENT_DELAY_VALUES_MS = [750, 800, 850, 900, 950, 1000, 1050] as const;
export const DEFAULT_SEGMENT_DELAY_MS = 900;
export const SEGMENT_DELAY_STEP_MS = 50;
export const SEGMENT_DELAY_MIN_MS = SEGMENT_DELAY_VALUES_MS[0];
export const SEGMENT_DELAY_MAX_MS = SEGMENT_DELAY_VALUES_MS[SEGMENT_DELAY_VALUES_MS.length - 1];

export function normalizeSegmentDelayMs(value: number): number {
  if (!Number.isFinite(value) || value < SEGMENT_DELAY_MIN_MS || value > SEGMENT_DELAY_MAX_MS) {
    return DEFAULT_SEGMENT_DELAY_MS;
  }

  return SEGMENT_DELAY_VALUES_MS.reduce((closest, current) =>
    Math.abs(current - value) < Math.abs(closest - value) ? current : closest,
  );
}

export function segmentDelayToConfig(delayMs: number) {
  const normalizedDelayMs = normalizeSegmentDelayMs(delayMs);
  const t = (normalizedDelayMs - SEGMENT_DELAY_MIN_MS) / (SEGMENT_DELAY_MAX_MS - SEGMENT_DELAY_MIN_MS);

  return {
    maxTurnChars: Math.round(90 + t * 80), // 90 .. 170 chars
    idlePendingMs: normalizedDelayMs,
  };
}
