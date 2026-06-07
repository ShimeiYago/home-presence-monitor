import type { ScheduledHandler } from "aws-lambda";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { z } from "zod";
import { DEVICE_IDS } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { queryActivitiesByDeviceAndRange } from "@home-presence-monitor/db/schema/activities";
import { queryLatestHeartbeatByDevice } from "@home-presence-monitor/db/schema/heartbeats";
import {
  getMonitorStateByDevice,
  type MonitorEvaluationUpdate,
  type MonitorStateRecord,
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
  consecutiveNonDetectionCount: number;
  transitionVersion: number;
};

type TransitionType = "異常発生" | "正常復旧";

type TransitionNotification = {
  deviceId: string;
  transition: TransitionType;
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

const isNotificationWindow = (now: Date): boolean => {
  const jstHour = (now.getUTCHours() + 9) % 24;
  return (
    jstHour >= MONITOR_THRESHOLDS.notificationQuietHoursStartHourJst &&
    jstHour <= MONITOR_THRESHOLDS.notificationQuietHoursEndHourJst
  );
};

const evaluateDevice = async (
  deviceId: string,
  previous: MonitorStateRecord | undefined,
  now: Date,
): Promise<DeviceHealth> => {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const fromIso = new Date(
    nowMs - MONITOR_THRESHOLDS.sensorActivityWindowMinutes * 60 * 1000,
  ).toISOString();

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

  const heartbeatHealthy = (() => {
    if (!latestHeartbeat) {
      reasons.push(`ラズパイ状態は未記録です（${heartbeatRuleText}）`);
      return false;
    }

    heartbeatAgeMinutes = minutesSince(latestHeartbeat.timestamp, nowMs);
    if (heartbeatAgeMinutes > MONITOR_THRESHOLDS.heartbeatStaleMinutes) {
      reasons.push(
        `ラズパイ状態: 最終受信から${heartbeatAgeMinutes}分（${heartbeatRuleText}）`,
      );
      return false;
    }

    return true;
  })();

  const activityTotal = activities.reduce(
    (sum, activity) => sum + activity.motionCount,
    0,
  );
  const sensorDetected =
    activityTotal >= MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold;
  const previousConsecutiveNonDetectionCount =
    previous?.consecutiveNonDetectionCount ??
    (previous?.isHealthy === false && previous.reason?.includes("センサー記録")
      ? MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold
      : 0);
  const consecutiveNonDetectionCount = sensorDetected
    ? 0
    : previousConsecutiveNonDetectionCount + 1;
  const sensorHealthy =
    consecutiveNonDetectionCount <
    MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold;
  const currentHealthy = heartbeatHealthy && sensorHealthy;
  const previousTransitionVersion = previous?.transitionVersion ?? 0;
  const transitionVersion =
    previous?.isHealthy !== undefined && previous.isHealthy !== currentHealthy
      ? previousTransitionVersion + 1
      : previousTransitionVersion;

  if (!sensorHealthy) {
    reasons.push(
      `センサー記録: 直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分のセンサー検知回数 ${activityTotal}回（生存条件 ${MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold}回以上 / 連続非検出 ${consecutiveNonDetectionCount}/${MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold}回）`,
    );
  }

  return {
    deviceId,
    isHealthy: currentHealthy,
    reason: reasons.length === 0 ? "正常" : reasons.join(" / "),
    heartbeatAgeMinutes,
    activityTotal,
    consecutiveNonDetectionCount,
    transitionVersion,
  };
};

const transitionFromPrevious = (
  previousHealthy: boolean | undefined,
  currentHealthy: boolean,
): TransitionType | undefined => {
  if (previousHealthy === undefined) {
    return undefined;
  }

  if (previousHealthy === currentHealthy) {
    return undefined;
  }

  return currentHealthy ? "正常復旧" : "異常発生";
};

const buildNotificationBatches = (
  notifications: TransitionNotification[],
): Array<{
  title: TransitionType;
  items: TransitionNotification[];
}> => {
  const abnormal = notifications.filter(
    (item) => item.transition === "異常発生",
  );
  const recovery = notifications.filter(
    (item) => item.transition === "正常復旧",
  );

  return [
    ...(abnormal.length > 0
      ? [
          {
            title: "異常発生" as const,
            items: abnormal,
          },
        ]
      : []),
    ...(recovery.length > 0
      ? [
          {
            title: "正常復旧" as const,
            items: recovery,
          },
        ]
      : []),
  ];
};

const buildLineNotificationMessage = (
  title: TransitionType,
  notifications: TransitionNotification[],
  frontendUrl: string,
): string => {
  const lines: string[] = [];
  lines.push(title);
  lines.push(`ダッシュボード: ${frontendUrl}`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${item.deviceId}: ${item.transition}`);
    if (item.transition === "異常発生") {
      lines.push(`  判定: 異常あり / ${item.current.reason}`);
    } else {
      lines.push("  判定: 正常");
    }
  }

  return lines.join("\n");
};

const buildSlackNotificationMessage = (
  title: TransitionType,
  notifications: TransitionNotification[],
  frontendUrl: string,
): string => {
  const lines: string[] = [];
  lines.push(title);
  lines.push(`<${frontendUrl}|ダッシュボード>`);
  lines.push("");

  for (const item of notifications) {
    lines.push(`- ${item.deviceId}: ${item.transition}`);
    if (item.transition === "異常発生") {
      lines.push(`  判定: 異常あり / ${item.current.reason}`);
    } else {
      lines.push("  判定: 正常");
    }
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

const sendNotificationBatch = async (
  batch: { title: TransitionType; items: TransitionNotification[] },
  frontendUrl: string,
  alertTopicArn: string,
  lineChannelAccessToken: string,
  lineGroupId: string,
): Promise<void> => {
  const slackPayload = toCustomNotificationPayload(
    batch.title,
    buildSlackNotificationMessage(batch.title, batch.items, frontendUrl),
    ["活動検知モニター", batch.title, "Monitor"],
  );
  const lineMessage = buildLineNotificationMessage(
    batch.title,
    batch.items,
    frontendUrl,
  );

  await Promise.all([
    publishSlackNotification(alertTopicArn, slackPayload),
    pushLineNotification(lineChannelAccessToken, lineGroupId, lineMessage),
  ]);
};

const persistEvaluations = async (
  evaluations: MonitorEvaluationUpdate[],
): Promise<void> => {
  await Promise.all(
    evaluations.map((record) => updateMonitorEvaluation(record)),
  );
};

export const handler: ScheduledHandler = async () => {
  const env = getEnv();
  const now = new Date();
  const nowIso = now.toISOString();
  const notifications: TransitionNotification[] = [];
  const evaluations: MonitorEvaluationUpdate[] = [];

  for (const deviceId of DEVICE_IDS) {
    const previous = await getMonitorStateByDevice({ deviceId });
    const current = await evaluateDevice(deviceId, previous, now);

    const previousHealthy = previous?.isHealthy;
    const transition = transitionFromPrevious(
      previousHealthy,
      current.isHealthy,
    );

    if (transition) {
      notifications.push({
        deviceId,
        transition,
        current,
      });
    }

    evaluations.push({
      deviceId,
      isHealthy: current.isHealthy,
      updatedAt: nowIso,
      reason: current.reason,
      heartbeatAgeMinutes: current.heartbeatAgeMinutes,
      activityTotal: current.activityTotal,
      consecutiveNonDetectionCount: current.consecutiveNonDetectionCount,
      transitionVersion: current.transitionVersion,
      ...(transition === undefined
        ? {}
        : {
            lastNotifiedTransitionVersion: current.transitionVersion,
          }),
    });
  }

  try {
    await persistEvaluations(evaluations);
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: nowIso,
        level: "error",
        message: "monitor_transition_persist_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
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

  if (!isNotificationWindow(now)) {
    console.log(
      JSON.stringify({
        timestamp: nowIso,
        level: "info",
        message: "monitor_transition_suppressed_quiet_hours",
        count: notifications.length,
      }),
    );
    return;
  }

  const notificationBatches = buildNotificationBatches(notifications);

  try {
    for (const batch of notificationBatches) {
      await sendNotificationBatch(
        batch,
        env.FRONTEND_URL,
        env.ALERT_TOPIC_ARN,
        env.LINE_CHANNEL_ACCESS_TOKEN,
        env.LINE_GROUP_ID,
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: nowIso,
        level: "error",
        message: "monitor_transition_notify_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }

  console.log(
    JSON.stringify({
      timestamp: nowIso,
      level: "info",
      message: "monitor_transition_notified",
      count: notifications.length,
    }),
  );
};
