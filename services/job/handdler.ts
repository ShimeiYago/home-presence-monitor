import type { ScheduledHandler } from "aws-lambda";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DEVICES } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { queryActivitiesByDeviceAndRange } from "@home-presence-monitor/db/schema/activities";
import { queryLatestHeartbeatByDevice } from "@home-presence-monitor/db/schema/heartbeats";
import {
  getMonitorStateByDevice,
  type MonitorEvaluationUpdate,
  type MonitorStateRecord,
  updateMonitorEvaluation,
} from "@home-presence-monitor/db/schema/monitor-states";
import { z } from "zod";

const HOUSE_MOTION_MONITOR_STATE_ID = "__house_motion__";
const HOUSE_MOTION_LABEL = "家全体";

const envSchema = z.object({
  ALERT_TOPIC_ARN: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_GROUP_ID: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

type TransitionType = "異常発生" | "正常復旧";

type DeviceHeartbeatEvaluation = {
  deviceId: string;
  label: string;
  isHealthy: boolean;
  reason: string;
  heartbeatAgeMinutes?: number;
  transitionVersion: number;
};

type HouseMotionEvaluation = {
  label: string;
  isHealthy: boolean;
  reason: string;
  activityTotal: number;
  consecutiveNonDetectionCount: number;
  transitionVersion: number;
};

type TransitionNotification = {
  label: string;
  transition: TransitionType;
  reason: string;
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

const floorToIntervalMs = (valueMs: number, intervalMs: number): number =>
  Math.floor(valueMs / intervalMs) * intervalMs;

const isNotificationWindow = (now: Date): boolean => {
  const jstHour = (now.getUTCHours() + 9) % 24;
  return (
    jstHour >= MONITOR_THRESHOLDS.notificationQuietHoursStartHourJst &&
    jstHour <= MONITOR_THRESHOLDS.notificationQuietHoursEndHourJst
  );
};

const transitionFromPrevious = (
  previousHealthy: boolean | undefined,
  currentHealthy: boolean,
): TransitionType | undefined => {
  if (previousHealthy === undefined || previousHealthy === currentHealthy) {
    return undefined;
  }

  return currentHealthy ? "正常復旧" : "異常発生";
};

const resolvePreviousHeartbeatHealth = (
  previous: MonitorStateRecord | undefined,
): boolean | undefined => {
  if (!previous) {
    return undefined;
  }

  const hasHeartbeatReason = previous.reason?.includes("ラズパイ状態") ?? false;
  const hasSensorReason = previous.reason?.includes("センサー記録") ?? false;

  if (previous.isHealthy === false && hasSensorReason && !hasHeartbeatReason) {
    return undefined;
  }

  return previous.isHealthy;
};

const evaluateDeviceHeartbeat = (params: {
  deviceId: string;
  label: string;
  previous: MonitorStateRecord | undefined;
  latestHeartbeatAt?: string;
  now: Date;
}): DeviceHeartbeatEvaluation => {
  const { deviceId, label, previous, latestHeartbeatAt, now } = params;
  const nowMs = now.getTime();
  const heartbeatRuleText = `${MONITOR_THRESHOLDS.heartbeatStaleMinutes}分以上未受信で異常`;
  let heartbeatAgeMinutes: number | undefined;

  const isHealthy = (() => {
    if (!latestHeartbeatAt) {
      return false;
    }

    heartbeatAgeMinutes = minutesSince(latestHeartbeatAt, nowMs);
    return heartbeatAgeMinutes <= MONITOR_THRESHOLDS.heartbeatStaleMinutes;
  })();

  const reason = (() => {
    if (!latestHeartbeatAt) {
      return `ラズパイ状態: 未記録です（${heartbeatRuleText}）`;
    }

    if (heartbeatAgeMinutes === undefined) {
      return `ラズパイ状態: 受信時刻を解釈できません（${heartbeatRuleText}）`;
    }

    if (!isHealthy) {
      return `ラズパイ状態: 最終受信から${heartbeatAgeMinutes}分（${heartbeatRuleText}）`;
    }

    return "正常";
  })();

  const previousHeartbeatHealthy = resolvePreviousHeartbeatHealth(previous);
  const previousTransitionVersion = previous?.transitionVersion ?? 0;
  const transitionVersion =
    previousHeartbeatHealthy !== undefined &&
    previousHeartbeatHealthy !== isHealthy
      ? previousTransitionVersion + 1
      : previousTransitionVersion;

  return {
    deviceId,
    label,
    isHealthy,
    reason,
    ...(heartbeatAgeMinutes === undefined ? {} : { heartbeatAgeMinutes }),
    transitionVersion,
  };
};

const evaluateHouseMotion = (params: {
  previous: MonitorStateRecord | undefined;
  activityTotal: number;
}): HouseMotionEvaluation => {
  const { previous, activityTotal } = params;
  const sensorDetected =
    activityTotal >= MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold;
  const previousConsecutiveNonDetectionCount =
    previous?.consecutiveNonDetectionCount ??
    (previous?.isHealthy === false
      ? MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold
      : 0);
  const consecutiveNonDetectionCount = sensorDetected
    ? 0
    : previousConsecutiveNonDetectionCount + 1;
  const isHealthy =
    consecutiveNonDetectionCount <
    MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold;
  const previousTransitionVersion = previous?.transitionVersion ?? 0;
  const transitionVersion =
    previous?.isHealthy !== undefined && previous.isHealthy !== isHealthy
      ? previousTransitionVersion + 1
      : previousTransitionVersion;

  return {
    label: HOUSE_MOTION_LABEL,
    isHealthy,
    reason: isHealthy
      ? "正常"
      : `家全体のセンサー記録: 直近${MONITOR_THRESHOLDS.sensorActivityWindowMinutes}分の合計 ${activityTotal}回（生存条件 ${MONITOR_THRESHOLDS.sensorMotionCountHealthyThreshold}回以上 / 連続非検出 ${consecutiveNonDetectionCount}/${MONITOR_THRESHOLDS.sensorConsecutiveNonDetectionAlertThreshold}回）`,
    activityTotal,
    consecutiveNonDetectionCount,
    transitionVersion,
  };
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
    lines.push(`- ${item.label}: ${item.transition}`);
    if (item.transition === "異常発生") {
      lines.push(`  判定: 異常あり / ${item.reason}`);
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
    lines.push(`- ${item.label}: ${item.transition}`);
    if (item.transition === "異常発生") {
      lines.push(`  判定: 異常あり / ${item.reason}`);
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
  const windowMs = MONITOR_THRESHOLDS.sensorActivityWindowMinutes * 60 * 1000;
  const windowEndMs = floorToIntervalMs(now.getTime(), windowMs);
  const windowStartMs = windowEndMs - windowMs;
  const fromIso = new Date(windowStartMs).toISOString();
  const toIso = new Date(windowEndMs).toISOString();

  const snapshots = await Promise.all(
    DEVICES.map(async (device) => {
      const [previous, latestHeartbeat, activities] = await Promise.all([
        getMonitorStateByDevice({ deviceId: device.id }),
        queryLatestHeartbeatByDevice({ deviceId: device.id }),
        queryActivitiesByDeviceAndRange({
          deviceId: device.id,
          from: fromIso,
          to: toIso,
        }),
      ]);

      return {
        device,
        previous,
        latestHeartbeatAt: latestHeartbeat?.timestamp,
        activityTotal: activities.reduce(
          (sum, activity) => sum + activity.motionCount,
          0,
        ),
      };
    }),
  );

  const previousHouseMotion = await getMonitorStateByDevice({
    deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
  });

  const notifications: TransitionNotification[] = [];
  const evaluations: MonitorEvaluationUpdate[] = [];

  for (const snapshot of snapshots) {
    const heartbeatEvaluation = evaluateDeviceHeartbeat({
      deviceId: snapshot.device.id,
      label: snapshot.device.label,
      previous: snapshot.previous,
      latestHeartbeatAt: snapshot.latestHeartbeatAt,
      now,
    });

    const heartbeatTransition = transitionFromPrevious(
      resolvePreviousHeartbeatHealth(snapshot.previous),
      heartbeatEvaluation.isHealthy,
    );

    if (heartbeatTransition) {
      notifications.push({
        label: heartbeatEvaluation.label,
        transition: heartbeatTransition,
        reason: heartbeatEvaluation.reason,
      });
    }

    evaluations.push({
      deviceId: heartbeatEvaluation.deviceId,
      isHealthy: heartbeatEvaluation.isHealthy,
      updatedAt: nowIso,
      reason: heartbeatEvaluation.reason,
      heartbeatAgeMinutes: heartbeatEvaluation.heartbeatAgeMinutes,
      activityTotal: snapshot.activityTotal,
      consecutiveNonDetectionCount: 0,
      transitionVersion: heartbeatEvaluation.transitionVersion,
      ...(heartbeatTransition === undefined
        ? {}
        : {
            lastNotifiedTransitionVersion:
              heartbeatEvaluation.transitionVersion,
          }),
    });
  }

  const houseMotionEvaluation = evaluateHouseMotion({
    previous: previousHouseMotion,
    activityTotal: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.activityTotal,
      0,
    ),
  });
  const houseMotionTransition = transitionFromPrevious(
    previousHouseMotion?.isHealthy,
    houseMotionEvaluation.isHealthy,
  );

  if (houseMotionTransition) {
    notifications.push({
      label: houseMotionEvaluation.label,
      transition: houseMotionTransition,
      reason: houseMotionEvaluation.reason,
    });
  }

  evaluations.push({
    deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
    isHealthy: houseMotionEvaluation.isHealthy,
    updatedAt: nowIso,
    reason: houseMotionEvaluation.reason,
    activityTotal: houseMotionEvaluation.activityTotal,
    consecutiveNonDetectionCount:
      houseMotionEvaluation.consecutiveNonDetectionCount,
    transitionVersion: houseMotionEvaluation.transitionVersion,
    ...(houseMotionTransition === undefined
      ? {}
      : {
          lastNotifiedTransitionVersion:
            houseMotionEvaluation.transitionVersion,
        }),
  });

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
