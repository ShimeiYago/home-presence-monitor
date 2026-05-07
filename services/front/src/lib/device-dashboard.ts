import type {
  GetActivitiesResponse,
  GetDeviceSourceIpResponse,
  GetLatestHeartbeatResponse,
} from "@home-presence-monitor/contracts/api";
import type { DeviceConfig } from "@home-presence-monitor/config/device";

export type SensorSummary = {
  recordCount: number;
  motionTotal: number;
};

export type DeviceDashboardSnapshot = {
  device: DeviceConfig;
  latestHeartbeatAt: string | null;
  sensorSummary: SensorSummary | null;
  sourceIpSummary: GetDeviceSourceIpResponse | null;
  errors: string[];
};

type DashboardResults = {
  activitiesResult: PromiseSettledResult<GetActivitiesResponse>;
  heartbeatResult: PromiseSettledResult<GetLatestHeartbeatResponse | null>;
  sourceIpResult: PromiseSettledResult<GetDeviceSourceIpResponse | null>;
};

const formatReason = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export const buildDeviceDashboardSnapshot = (
  device: DeviceConfig,
  results: DashboardResults,
): DeviceDashboardSnapshot => {
  const errors: string[] = [];
  let sensorSummary: SensorSummary | null = null;
  let latestHeartbeatAt: string | null = null;
  let sourceIpSummary: GetDeviceSourceIpResponse | null = null;

  if (results.activitiesResult.status === "fulfilled") {
    const { activities } = results.activitiesResult.value;
    sensorSummary = {
      recordCount: activities.length,
      motionTotal: activities.reduce(
        (sum, activity) => sum + activity.motionCount,
        0,
      ),
    };
  } else {
    errors.push(
      `Activities取得失敗: ${formatReason(results.activitiesResult.reason)}`,
    );
  }

  if (results.heartbeatResult.status === "fulfilled") {
    latestHeartbeatAt = results.heartbeatResult.value?.lastHeartbeatAt ?? null;
  } else {
    errors.push(
      `Heartbeat取得失敗: ${formatReason(results.heartbeatResult.reason)}`,
    );
  }

  if (results.sourceIpResult.status === "fulfilled") {
    sourceIpSummary = results.sourceIpResult.value;
  } else {
    errors.push(
      `送信元IP取得失敗: ${formatReason(results.sourceIpResult.reason)}`,
    );
  }

  return {
    device,
    latestHeartbeatAt,
    sensorSummary,
    sourceIpSummary,
    errors,
  };
};
