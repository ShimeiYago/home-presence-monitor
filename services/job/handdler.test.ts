import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  deviceIds,
  getMonitorStateByDeviceMock,
  queryActivitiesByDeviceAndRangeMock,
  queryLatestHeartbeatByDeviceMock,
  sendMock,
  updateMonitorEvaluationMock,
  fetchMock,
} = vi.hoisted(() => ({
  deviceIds: ["device01"] as string[],
  getMonitorStateByDeviceMock: vi.fn(),
  queryActivitiesByDeviceAndRangeMock: vi.fn(),
  queryLatestHeartbeatByDeviceMock: vi.fn(),
  sendMock: vi.fn(),
  updateMonitorEvaluationMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@home-presence-monitor/config/device", () => ({
  DEVICE_IDS: deviceIds,
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
  PublishCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
  SNSClient: vi.fn(() => ({
    send: sendMock,
  })),
}));

import { handler } from "./handdler";

type MonitorStateMock = {
  deviceId: string;
  isHealthy?: boolean;
  consecutiveNonDetectionCount?: number;
  transitionVersion?: number;
  lastNotifiedTransitionVersion?: number;
  updatedAt?: string;
  reason?: string;
  heartbeatAgeMinutes?: number;
  activityTotal?: number;
};

type HeartbeatMock = {
  deviceId: string;
  timestamp: string;
  createdAt: string;
  ttl: number;
};

type ActivityMock = {
  deviceId: string;
  windowStart: string;
  windowEnd: string;
  motionCount: number;
  createdAt: string;
  ttl: number;
};

const makeHeartbeat = (
  overrides: Partial<HeartbeatMock> = {},
): HeartbeatMock => ({
  deviceId: "device01",
  timestamp: "2026-06-07T01:05:00.000Z",
  createdAt: "2026-06-07T01:05:00.000Z",
  ttl: 0,
  ...overrides,
});

const makeActivity = (motionCount: number): ActivityMock => ({
  deviceId: "device01",
  windowStart: "2026-06-07T01:00:00.000Z",
  windowEnd: "2026-06-07T01:10:00.000Z",
  motionCount,
  createdAt: "2026-06-07T01:10:00.000Z",
  ttl: 0,
});

const mockSingleDeviceScenario = (params: {
  previousState: MonitorStateMock | undefined;
  heartbeat: HeartbeatMock | undefined;
  activities: ActivityMock[];
}) => {
  getMonitorStateByDeviceMock.mockResolvedValue(params.previousState);
  queryLatestHeartbeatByDeviceMock.mockResolvedValue(params.heartbeat);
  queryActivitiesByDeviceAndRangeMock.mockResolvedValue(params.activities);
};

const parsePublishedMessage = (callIndex: number) => {
  const command = sendMock.mock.calls[callIndex]?.[0] as {
    input?: { Message?: string };
  };

  return JSON.parse(command.input?.Message ?? "{}") as {
    content?: { title?: string; description?: string };
  };
};

describe("monitor job handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:10:00.000Z"));

    process.env.ALERT_TOPIC_ARN =
      "arn:aws:sns:ap-northeast-1:123456789012:test";
    process.env.FRONTEND_URL = "https://example.com";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    process.env.LINE_GROUP_ID = "line-group";

    deviceIds.splice(0, deviceIds.length, "device01");

    getMonitorStateByDeviceMock.mockReset();
    queryActivitiesByDeviceAndRangeMock.mockReset();
    queryLatestHeartbeatByDeviceMock.mockReset();
    sendMock.mockReset();
    updateMonitorEvaluationMock.mockReset();
    fetchMock.mockReset();

    getMonitorStateByDeviceMock.mockResolvedValue(undefined);
    queryActivitiesByDeviceAndRangeMock.mockResolvedValue([]);
    queryLatestHeartbeatByDeviceMock.mockResolvedValue(makeHeartbeat());
    sendMock.mockResolvedValue(undefined);
    updateMonitorEvaluationMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue(""),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not notify on the fifth consecutive non-detection", async () => {
    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 4,
      },
      heartbeat: makeHeartbeat(),
      activities: [],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateMonitorEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 5,
        activityTotal: 0,
      }),
    );
  });

  it("notifies abnormal on the sixth consecutive non-detection", async () => {
    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 5,
      },
      heartbeat: makeHeartbeat(),
      activities: [],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateMonitorEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: false,
        consecutiveNonDetectionCount: 6,
        activityTotal: 0,
      }),
    );

    const published = parsePublishedMessage(0);
    expect(published.content?.title).toBe("異常発生");
    expect(published.content?.description).toContain("device01");
  });

  it("notifies recovery after one healthy observation", async () => {
    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: false,
        consecutiveNonDetectionCount: 6,
      },
      heartbeat: makeHeartbeat(),
      activities: [makeActivity(3)],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateMonitorEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 0,
        activityTotal: 3,
      }),
    );

    const published = parsePublishedMessage(0);
    expect(published.content?.title).toBe("正常復旧");
    expect(published.content?.description).toContain("device01");
  });

  it("uses the last closed 10-minute window even when invoked mid-minute", async () => {
    vi.setSystemTime(new Date("2026-06-07T01:10:42.000Z"));

    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: false,
        consecutiveNonDetectionCount: 6,
      },
      heartbeat: makeHeartbeat({
        timestamp: "2026-06-07T01:10:00.000Z",
        createdAt: "2026-06-07T01:10:00.000Z",
      }),
      activities: [makeActivity(4)],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(queryActivitiesByDeviceAndRangeMock).toHaveBeenCalledWith({
      deviceId: "device01",
      from: "2026-06-07T01:00:00.000Z",
      to: "2026-06-07T01:10:00.000Z",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not resend a transition that is already recorded as notified", async () => {
    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 0,
        transitionVersion: 1,
        lastNotifiedTransitionVersion: 1,
      },
      heartbeat: makeHeartbeat(),
      activities: [makeActivity(3)],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateMonitorEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: true,
        transitionVersion: 1,
        activityTotal: 3,
      }),
    );
  });

  it("skips notifications outside the JST notification window", async () => {
    vi.setSystemTime(new Date("2026-06-07T15:10:00.000Z"));

    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 5,
      },
      heartbeat: makeHeartbeat({
        timestamp: "2026-06-07T15:05:00.000Z",
        createdAt: "2026-06-07T15:05:00.000Z",
      }),
      activities: [],
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateMonitorEvaluationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: false,
        consecutiveNonDetectionCount: 6,
        activityTotal: 0,
      }),
    );
  });

  it("sends abnormal and recovery notifications separately when both happen in one run", async () => {
    deviceIds.splice(0, deviceIds.length, "device01", "device02");

    getMonitorStateByDeviceMock.mockImplementation(async ({ deviceId }) => {
      if (deviceId === "device01") {
        return {
          deviceId: "device01",
          isHealthy: true,
          consecutiveNonDetectionCount: 5,
        };
      }

      return {
        deviceId: "device02",
        isHealthy: false,
        consecutiveNonDetectionCount: 6,
      };
    });

    queryLatestHeartbeatByDeviceMock.mockImplementation(
      async ({ deviceId }) => {
        return makeHeartbeat({
          deviceId,
          timestamp: "2026-06-07T01:05:00.000Z",
          createdAt: "2026-06-07T01:05:00.000Z",
        });
      },
    );

    queryActivitiesByDeviceAndRangeMock.mockImplementation(
      async ({ deviceId }) => {
        if (deviceId === "device01") {
          return [];
        }

        return [makeActivity(3)];
      },
    );

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const publishedTitles = sendMock.mock.calls.map(([command]) => {
      const input = command as { input?: { Message?: string } };
      return JSON.parse(input.input?.Message ?? "{}").content?.title;
    });
    expect(publishedTitles).toEqual(["異常発生", "正常復旧"]);
    expect(updateMonitorEvaluationMock).toHaveBeenCalledTimes(2);
  });

  it("persists the new state before notification delivery fails", async () => {
    mockSingleDeviceScenario({
      previousState: {
        deviceId: "device01",
        isHealthy: true,
        consecutiveNonDetectionCount: 5,
      },
      heartbeat: makeHeartbeat(),
      activities: [],
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: vi.fn().mockResolvedValue("boom"),
    });

    await expect(handler({} as never, {} as never, vi.fn())).rejects.toThrow(
      "LINE push API request failed",
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateMonitorEvaluationMock).toHaveBeenCalledTimes(1);
  });
});
