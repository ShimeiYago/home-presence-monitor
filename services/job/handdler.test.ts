import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getMonitorStateByDeviceMock,
  queryActivitiesByDeviceAndRangeMock,
  queryLatestHeartbeatByDeviceMock,
  sendMock,
  updateMonitorEvaluationMock,
  fetchMock,
} = vi.hoisted(() => ({
  getMonitorStateByDeviceMock: vi.fn(),
  queryActivitiesByDeviceAndRangeMock: vi.fn(),
  queryLatestHeartbeatByDeviceMock: vi.fn(),
  sendMock: vi.fn(),
  updateMonitorEvaluationMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@home-presence-monitor/db/schema/activities", () => ({
  queryActivitiesByDeviceAndRange: queryActivitiesByDeviceAndRangeMock,
}));

vi.mock("@home-presence-monitor/db/schema/heartbeats", () => ({
  queryLatestHeartbeatByDevice: queryLatestHeartbeatByDeviceMock,
}));

vi.mock("@home-presence-monitor/db/schema/monitor-states", () => ({
  getMonitorStateByDevice: getMonitorStateByDeviceMock,
  updateMonitorEvaluation: updateMonitorEvaluationMock,
}));

vi.mock("@aws-sdk/client-sns", () => ({
  PublishCommand: vi.fn(),
  SNSClient: vi.fn(() => ({
    send: sendMock,
  })),
}));

import { handler } from "./handdler";

describe("monitor job handler", () => {
  beforeEach(() => {
    process.env.ALERT_TOPIC_ARN =
      "arn:aws:sns:ap-northeast-1:123456789012:test";
    process.env.FRONTEND_URL = "https://example.com";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    process.env.LINE_GROUP_ID = "line-group";

    getMonitorStateByDeviceMock.mockReset();
    queryActivitiesByDeviceAndRangeMock.mockReset();
    queryLatestHeartbeatByDeviceMock.mockReset();
    sendMock.mockReset();
    updateMonitorEvaluationMock.mockReset();
    fetchMock.mockReset();

    getMonitorStateByDeviceMock.mockResolvedValue({
      deviceId: "device01",
      isHealthy: true,
    });
    queryActivitiesByDeviceAndRangeMock.mockResolvedValue([]);
    queryLatestHeartbeatByDeviceMock.mockResolvedValue({
      deviceId: "device01",
      timestamp: "2026-06-07T00:00:00.000Z",
      createdAt: "2026-06-07T00:00:00.000Z",
      ttl: 0,
    });
    sendMock.mockResolvedValue(undefined);
    updateMonitorEvaluationMock.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: vi.fn().mockResolvedValue("boom"),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("does not persist the new state when notification delivery fails", async () => {
    await expect(handler({} as never, {} as never, vi.fn())).rejects.toThrow(
      "LINE push API request failed",
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateMonitorEvaluationMock).not.toHaveBeenCalled();
  });
});
