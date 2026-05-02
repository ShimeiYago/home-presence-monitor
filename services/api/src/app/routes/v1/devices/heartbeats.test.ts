import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "src/app/app";

const { putHeartbeatMock, updateLatestObservedSourceIpMock } = vi.hoisted(
  () => ({
    putHeartbeatMock: vi.fn(),
    updateLatestObservedSourceIpMock: vi.fn(),
  }),
);

vi.mock("@home-presence-monitor/db/schema/heartbeats", () => ({
  putHeartbeat: putHeartbeatMock,
  queryHeartbeatsByDeviceAndRange: vi.fn(),
  queryLatestHeartbeatByDevice: vi.fn(),
}));

vi.mock("@home-presence-monitor/db/schema/monitor-states", () => ({
  updateLatestObservedSourceIp: updateLatestObservedSourceIpMock,
}));

describe("device heartbeats route", () => {
  beforeEach(() => {
    putHeartbeatMock.mockReset();
    updateLatestObservedSourceIpMock.mockReset();
  });

  it("stores the latest observed source ip on heartbeat post", async () => {
    const app = createApp();
    const response = await app.request("/v1/devices/device01/heartbeats", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
      body: JSON.stringify({
        timestamp: "2026-05-02T00:00:00.000Z",
      }),
    });

    expect(response.status).toBe(201);
    expect(putHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(updateLatestObservedSourceIpMock).toHaveBeenCalledTimes(1);
    expect(updateLatestObservedSourceIpMock).toHaveBeenCalledWith({
      deviceId: "device01",
      sourceIp: "203.0.113.10",
      observedAt: expect.any(String),
    });
  });
});
