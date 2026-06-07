export const MONITOR_THRESHOLDS = {
  heartbeatStaleMinutes: 11,
  sensorMotionCountAlertThreshold: 0,
  sensorActivityWindowMinutes: 10,
  sensorMotionCountHealthyThreshold: 3,
  sensorConsecutiveNonDetectionAlertThreshold: 6,
  notificationQuietHoursStartHourJst: 9,
  notificationQuietHoursEndHourJst: 23,
} as const;

export const PI_POST_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffSec: 1.0,
} as const;
