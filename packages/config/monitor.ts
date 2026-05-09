export const MONITOR_THRESHOLDS = {
  heartbeatStaleMinutes: 11,
  sensorMotionCountAlertThreshold: 0,
} as const;

export const PI_POST_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffSec: 1.0,
} as const;
