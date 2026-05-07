import { getDeviceLabel } from "@home-presence-monitor/config/device";

export type DeviceHealth = {
  deviceId: string;
  isHealthy: boolean;
  reason: string;
  heartbeatAgeMinutes?: number;
  activityTotal: number;
};

export type TransitionNotification = {
  deviceId: string;
  transition: "初回異常" | "正常→異常" | "異常→正常";
  current: DeviceHealth;
};

export const transitionFromPrevious = (
  previousHealthy: boolean | undefined,
  currentHealthy: boolean,
): TransitionNotification["transition"] | undefined => {
  if (previousHealthy === undefined) {
    return currentHealthy ? undefined : "初回異常";
  }

  if (previousHealthy === currentHealthy) {
    return undefined;
  }

  return previousHealthy ? "正常→異常" : "異常→正常";
};

export const buildNotificationHeadline = (
  notifications: TransitionNotification[],
): string => {
  if (notifications.every((item) => item.current.isHealthy)) {
    return "状態が正常になりました";
  }

  if (notifications.every((item) => !item.current.isHealthy)) {
    return "状態が異常になりました";
  }

  return "状態が正常/異常に変化しました";
};

export const buildNotificationMessage = (
  notifications: TransitionNotification[],
  frontendUrl: string,
): string => {
  const headline = `活動検知モニター ${buildNotificationHeadline(notifications)} (${notifications.length}件)`;
  const lines: string[] = [];
  lines.push(headline);
  lines.push(`ダッシュボード: ${frontendUrl}`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${getDeviceLabel(item.deviceId)}: ${item.transition}`);
    if (item.current.isHealthy) {
      lines.push("  判定: 正常");
    } else {
      lines.push(`  判定: 異常あり / ${item.current.reason}`);
    }
  }

  return lines.join("\n");
};
