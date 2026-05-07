import type { ScheduledHandler } from "aws-lambda";
import { z } from "zod";
import { DEVICES } from "@home-presence-monitor/config/device";
import { MONITOR_THRESHOLDS } from "@home-presence-monitor/config/monitor";
import { queryActivitiesByDeviceAndRange } from "@home-presence-monitor/db/schema/activities";
import { queryLatestHeartbeatByDevice } from "@home-presence-monitor/db/schema/heartbeats";
import {
  getMonitorStateByDevice,
  updateMonitorEvaluation,
} from "@home-presence-monitor/db/schema/monitor-states";
import {
  buildNotificationMessage,
  transitionFromPrevious,
  type DeviceHealth,
  type TransitionNotification,
} from "./notifications";

const envSchema = z.object({
  FRONTEND_URL: z.string().url(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_GROUP_ID: z.string().min(1),
});

type Env = z.infer<typeof envSchema>;

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

  for (const device of DEVICES) {
    const current = await evaluateDevice(device.id, now);
    const previous = await getMonitorStateByDevice({ deviceId: device.id });
    const transition = transitionFromPrevious(
      previous?.isHealthy,
      current.isHealthy,
    );

    if (transition) {
      notifications.push({
        deviceId: device.id,
        transition,
        current,
      });
    }

    await updateMonitorEvaluation({
      deviceId: device.id,
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

  await pushLineNotification(
    env.LINE_CHANNEL_ACCESS_TOKEN,
    env.LINE_GROUP_ID,
    buildNotificationMessage(notifications, env.FRONTEND_URL),
  );

  console.log(
    JSON.stringify({
      timestamp: nowIso,
      level: "info",
      message: "monitor_transition_notified",
      count: notifications.length,
    }),
  );
};
