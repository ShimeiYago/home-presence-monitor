import type { ScheduledHandler } from "aws-lambda";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { z } from "zod";
import { DEVICE_IDS } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { queryActivitiesByDeviceAndRange } from "@home-presence-monitor/db/schema/activities";
import { queryLatestHeartbeatByDevice } from "@home-presence-monitor/db/schema/heartbeats";
import {
  getMonitorStateByDevice,
  putMonitorState,
} from "@home-presence-monitor/db/schema/monitor-states";

const envSchema = z.object({
  ALERT_TOPIC_ARN: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

type DeviceHealth = {
  deviceId: string;
  isHealthy: boolean;
  reason: string;
  heartbeatAgeMinutes?: number;
  activityTotal: number;
};

type TransitionNotification = {
  deviceId: string;
  transition: "初回異常" | "正常→異常" | "異常→正常";
  current: DeviceHealth;
};

type CustomNotificationPayload = {
  version: "1.0";
  source: "custom";
  content: {
    textType: "client-markdown";
    title: string;
    description: string;
    keywords?: string[];
  };
};

let cachedEnv: Env | undefined;

const getEnv = (): Env => {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
};

const minutesSince = (value: string, nowMs: number): number => {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return Number.POSITIVE_INFINITY;
  }

  const deltaMs = nowMs - timestampMs;
  return Math.max(0, Math.floor(deltaMs / 60000));
};

const evaluateDevice = async (
  deviceId: string,
  now: Date,
): Promise<DeviceHealth> => {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const fromIso = new Date(nowMs - 60 * 60 * 1000).toISOString();

  const [latestHeartbeat, activities] = await Promise.all([
    queryLatestHeartbeatByDevice({ deviceId }),
    queryActivitiesByDeviceAndRange({
      deviceId,
      from: fromIso,
      to: nowIso,
    }),
  ]);

  const reasons: string[] = [];
  let heartbeatAgeMinutes: number | undefined;

  if (!latestHeartbeat) {
    reasons.push("heartbeat未記録");
  } else {
    heartbeatAgeMinutes = minutesSince(latestHeartbeat.timestamp, nowMs);
    if (heartbeatAgeMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
      reasons.push(
        `heartbeat最終受信から${heartbeatAgeMinutes}分経過（閾値${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分）`,
      );
    }
  }

  const activityTotal = activities.reduce(
    (sum, activity) => sum + activity.motionCount,
    0,
  );
  if (activityTotal <= MONITOR_THRESHOLDS.sensorMotionCountAlertThreshold) {
    reasons.push(
      `直近1時間のactivity合計${activityTotal}回（閾値${MONITOR_THRESHOLDS.sensorMotionCountAlertThreshold}回超過）`,
    );
  }

  return {
    deviceId,
    isHealthy: reasons.length === 0,
    reason: reasons.length === 0 ? "正常" : reasons.join(" / "),
    heartbeatAgeMinutes,
    activityTotal,
  };
};

const transitionFromPrevious = (
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

const buildNotificationMessage = (
  notifications: TransitionNotification[],
  nowIso: string,
): string => {
  const lines: string[] = [];
  lines.push(`監視状態の遷移を検知しました (${nowIso})`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${item.deviceId}: ${item.transition}`);
    lines.push(
      `  判定: ${item.current.isHealthy ? "正常" : "異常"} / ${item.current.reason}`,
    );
    if (item.current.heartbeatAgeMinutes !== undefined) {
      lines.push(`  heartbeat経過: ${item.current.heartbeatAgeMinutes}分`);
    } else {
      lines.push("  heartbeat経過: 未記録");
    }
    lines.push(`  activity合計(直近1時間): ${item.current.activityTotal}回`);
  }

  return lines.join("\n");
};

const toCustomNotificationPayload = (
  title: string,
  description: string,
  keywords?: string[],
): CustomNotificationPayload => ({
  version: "1.0",
  source: "custom",
  content: {
    textType: "client-markdown",
    title,
    description,
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
  },
});

const snsClient = new SNSClient({});

const publishNotification = async (
  topicArn: string,
  payload: CustomNotificationPayload,
): Promise<void> => {
  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(payload),
    }),
  );
};

export const handler: ScheduledHandler = async () => {
  const env = getEnv();
  const now = new Date();
  const nowIso = now.toISOString();
  const notifications: TransitionNotification[] = [];

  for (const deviceId of DEVICE_IDS) {
    const current = await evaluateDevice(deviceId, now);
    const previous = await getMonitorStateByDevice({ deviceId });
    const transition = transitionFromPrevious(
      previous?.isHealthy,
      current.isHealthy,
    );

    if (transition) {
      notifications.push({
        deviceId,
        transition,
        current,
      });
    }

    await putMonitorState({
      deviceId,
      isHealthy: current.isHealthy,
      updatedAt: nowIso,
      reason: current.reason,
      heartbeatAgeMinutes: current.heartbeatAgeMinutes,
      activityTotal: current.activityTotal,
    });
  }

  if (notifications.length === 0) {
    console.log(
      JSON.stringify({
        timestamp: nowIso,
        level: "info",
        message: "monitor_transition_none",
      }),
    );
    return;
  }

  const transitionPayload = toCustomNotificationPayload(
    `:rotating_light: HomePresenceMonitor 遷移通知 (${notifications.length}件)`,
    buildNotificationMessage(notifications, nowIso),
    ["HomePresenceMonitor", "Transition", "Monitor"],
  );
  await publishNotification(env.ALERT_TOPIC_ARN, transitionPayload);

  console.log(
    JSON.stringify({
      timestamp: nowIso,
      level: "info",
      message: "monitor_transition_notified",
      count: notifications.length,
    }),
  );
};
