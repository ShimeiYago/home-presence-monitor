export const MONITOR_THRESHOLDS = {
  heartbeatStaleMinutes: 11,
  sensorMotionCountAlertThreshold: 0,
  sensorActivityWindowMinutes: 10,
  sensorMotionCountHealthyThreshold: 2,
  sensorConsecutiveNonDetectionAlertThreshold: 7,
  notificationQuietHoursStartHourJst: 9,
  notificationQuietHoursEndHourJst: 23,
} as const;

export const PI_POST_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffSec: 1.0,
} as const;
