import { describe, expect, it } from "vitest";
import { buildDeviceDashboardSnapshot } from "@/lib/device-dashboard";

describe("device dashboard snapshot builder", () => {
  it("keeps successful results when one request fails", () => {
    const snapshot = buildDeviceDashboardSnapshot(
      {
        id: "device02",
        name: "デバイス02",
      },
      {
        activitiesResult: {
          status: "fulfilled",
          value: {
            deviceId: "device02",
            activities: [
              {
                windowStart: "2026-05-07T00:00:00.000Z",
                windowEnd: "2026-05-07T00:10:00.000Z",
                motionCount: 2,
              },
            ],
          },
        },
        heartbeatResult: {
          status: "rejected",
          reason: new Error("timeout"),
        },
        sourceIpResult: {
          status: "fulfilled",
          value: {
            deviceId: "device02",
            sourceIp: "203.0.113.10",
            observedAt: "2026-05-07T00:00:00.000Z",
          },
        },
      },
    );

    expect(snapshot.sensorSummary).toEqual({
      recordCount: 1,
      motionTotal: 2,
    });
    expect(snapshot.sourceIpSummary?.sourceIp).toBe("203.0.113.10");
    expect(snapshot.latestHeartbeatAt).toBeNull();
    expect(snapshot.errors).toEqual(["Heartbeat取得失敗: timeout"]);
  });
});
