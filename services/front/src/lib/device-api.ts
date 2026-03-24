import type {
  GetActivitiesResponse,
  GetHeartbeatsResponse,
  GetLatestHeartbeatResponse,
} from "@home-presence-monitor/contracts/api";
import type { TimeRange } from "@/lib/time-range";
import { parseApiErrorMessage } from "@/lib/runtime-config";

export const fetchActivities = async (
  baseUrl: string,
  apiKey: string,
  deviceId: string,
  range: TimeRange,
): Promise<GetActivitiesResponse> => {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
  });

  const response = await fetch(
    `${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/activities?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response));
  }

  return (await response.json()) as GetActivitiesResponse;
};

export const fetchLatestHeartbeat = async (
  baseUrl: string,
  apiKey: string,
  deviceId: string,
): Promise<GetLatestHeartbeatResponse | null> => {
  const response = await fetch(
    `${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/heartbeats/latest`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response));
  }

  return (await response.json()) as GetLatestHeartbeatResponse;
};

export const fetchHeartbeats = async (
  baseUrl: string,
  apiKey: string,
  deviceId: string,
  range: TimeRange,
): Promise<GetHeartbeatsResponse> => {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
  });

  const response = await fetch(
    `${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/heartbeats?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response));
  }

  return (await response.json()) as GetHeartbeatsResponse;
};
