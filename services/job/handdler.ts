import type { ScheduledHandler } from "aws-lambda";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { z } from "zod";
import { DEVICE_IDS } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { queryActivitiesByDeviceAndRange } from "@home-presence-monitor/db/schema/activities";
import { queryLatestHeartbeatByDevice } from "@home-presence-monitor/db/schema/heartbeats";
import {
  getMonitorStateByDevice,
  updateMonitorEvaluation,
} from "@home-presence-monitor/db/schema/monitor-states";

const envSchema = z.object({
  ALERT_TOPIC_ARN: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_GROUP_ID: z.string().min(1),
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
  const heartbeatRuleText = `${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分以上未受信で異常`;

  if (!latestHeartbeat) {
    reasons.push(`ラズパイ状態は未記録です（${heartbeatRuleText}）`);
  } else {
    heartbeatAgeMinutes = minutesSince(latestHeartbeat.timestamp, nowMs);
    if (heartbeatAgeMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
      reasons.push(
        `ラズパイ状態: 最終受信から${heartbeatAgeMinutes}分（${heartbeatRuleText}）`,
      );
    }
  }

  const activityTotal = activities.reduce(
    (sum, activity) => sum + activity.motionCount,
    0,
  );
  if (activityTotal <= MONITOR_THRESHOLDS.sensorMotionCountAlertThreshold) {
    reasons.push(
      `センサー記録: 直近1時間のセンサー検知回数 ${activityTotal}回（閾値${MONITOR_THRESHOLDS.sensorMotionCountAlertThreshold}回超過で正常）`,
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

const buildLineNotificationMessage = (
  notifications: TransitionNotification[],
  frontendUrl: string,
): string => {
  const headline = `活動検知モニター ${buildNotificationHeadline(notifications)} (${notifications.length}件)`;
  const lines: string[] = [];
  lines.push(headline);
  lines.push(`ダッシュボード: ${frontendUrl}`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${item.deviceId}: ${item.transition}`);
    if (item.current.isHealthy) {
      lines.push("  判定: 正常");
    } else {
      lines.push(`  判定: 異常あり / ${item.current.reason}`);
    }
  }

  return lines.join("\n");
};

const buildSlackNotificationMessage = (
  notifications: TransitionNotification[],
  frontendUrl: string,
): string => {
  const lines: string[] = [];
  lines.push(`<${frontendUrl}|ダッシュボード>`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${item.deviceId}: ${item.transition}`);
    if (item.current.isHealthy) {
      lines.push("  判定: 正常");
    } else {
      lines.push(`  判定: 異常あり / ${item.current.reason}`);
    }
  }

  return lines.join("\n");
};

const buildNotificationHeadline = (
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

const publishSlackNotification = async (
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

const pushLineNotification = async (
  channelAccessToken: string,
  groupId: string,
  text: string,
): Promise<void> => {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });

  if (response.ok) {
    return;
  }

  const responseText = await response.text();
  throw new Error(
    `LINE push API request failed: ${response.status} ${response.statusText} ${responseText}`,
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

    await updateMonitorEvaluation({
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

  const headline = buildNotificationHeadline(notifications);
  const slackPayload = toCustomNotificationPayload(
    `:rotating_light: 活動検知モニター ${headline} (${notifications.length}件)`,
    buildSlackNotificationMessage(notifications, env.FRONTEND_URL),
    ["活動検知モニター", "Transition", "Monitor"],
  );
  const lineMessage = buildLineNotificationMessage(
    notifications,
    env.FRONTEND_URL,
  );

  await Promise.all([
    publishSlackNotification(env.ALERT_TOPIC_ARN, slackPayload),
    pushLineNotification(
      env.LINE_CHANNEL_ACCESS_TOKEN,
      env.LINE_GROUP_ID,
      lineMessage,
    ),
  ]);

  console.log(
    JSON.stringify({
      timestamp: nowIso,
      level: "info",
      message: "monitor_transition_notified",
      count: notifications.length,
    }),
  );
};
