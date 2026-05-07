import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "src/app/app";

const { getMonitorStateByDeviceMock } = vi.hoisted(() => ({
  getMonitorStateByDeviceMock: vi.fn(),
}));

vi.mock("@home-presence-monitor/db/schema/monitor-states", () => ({
  getMonitorStateByDevice: getMonitorStateByDeviceMock,
}));

describe("device source ip route", () => {
  beforeEach(() => {
    getMonitorStateByDeviceMock.mockReset();
  });

  it("returns 404 when the latest source ip is unavailable", async () => {
    getMonitorStateByDeviceMock.mockResolvedValue({
      deviceId: "device01",
      isHealthy: true,
      updatedAt: "2026-05-02T00:00:00.000Z",
      reason: "正常",
      activityTotal: 10,
    });

    const app = createApp();
    const response = await app.request("/v1/devices/device01/source-ip", {
      method: "GET",
    });

    expect(response.status).toBe(404);
  });

  it("returns the latest observed source ip", async () => {
    getMonitorStateByDeviceMock.mockResolvedValue({
      deviceId: "device01",
      lastObservedSourceIp: "203.0.113.10",
      lastObservedSourceIpAt: "2026-05-02T01:23:45.000Z",
    });

    const app = createApp();
    const response = await app.request("/v1/devices/device01/source-ip", {
      method: "GET",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deviceId: "device01",
      sourceIp: "203.0.113.10",
      observedAt: "2026-05-02T01:23:45.000Z",
    });
  });

  it("returns 404 for unknown devices before reading monitor state", async () => {
    const app = createApp();
    const response = await app.request("/v1/devices/unknown-device/source-ip", {
      method: "GET",
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Device not found: unknown-device",
      },
    });
    expect(getMonitorStateByDeviceMock).not.toHaveBeenCalled();
  });
});
