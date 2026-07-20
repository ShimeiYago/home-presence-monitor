import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUSE_MOTION_MONITOR_STATE_ID = "__house_motion__";

const {
  devices,
  getMonitorStateByDeviceMock,
  queryActivitiesByDeviceAndRangeMock,
  queryLatestHeartbeatByDeviceMock,
  sendMock,
  updateMonitorEvaluationMock,
  fetchMock,
} = vi.hoisted(() => ({
  devices: [
    { id: "device01", label: "デバイス1" },
    { id: "device02", label: "デバイス2" },
  ] as Array<{ id: string; label: string }>,
  getMonitorStateByDeviceMock: vi.fn(),
  queryActivitiesByDeviceAndRangeMock: vi.fn(),
  queryLatestHeartbeatByDeviceMock: vi.fn(),
  sendMock: vi.fn(),
  updateMonitorEvaluationMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@home-presence-monitor/config/devices", () => ({
  DEVICES: devices,
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
  deviceId: string,
  overrides: Partial<HeartbeatMock> = {},
): HeartbeatMock => ({
  deviceId,
  timestamp: "2026-06-07T01:05:00.000Z",
  createdAt: "2026-06-07T01:05:00.000Z",
  ttl: 0,
  ...overrides,
});

const makeActivity = (
  deviceId: string,
  motionCount: number,
  overrides: Partial<ActivityMock> = {},
): ActivityMock => ({
  deviceId,
  windowStart: "2026-06-07T01:00:00.000Z",
  windowEnd: "2026-06-07T01:10:00.000Z",
  motionCount,
  createdAt: "2026-06-07T01:10:00.000Z",
  ttl: 0,
  ...overrides,
});

const mockScenario = (params?: {
  previousStates?: Record<string, MonitorStateMock | undefined>;
  heartbeats?: Record<string, HeartbeatMock | undefined>;
  activities?: Record<string, ActivityMock[]>;
}) => {
  const previousStates = params?.previousStates ?? {};
  const heartbeats = params?.heartbeats ?? {};
  const activities = params?.activities ?? {};

  getMonitorStateByDeviceMock.mockImplementation(async ({ deviceId }) => {
    return previousStates[deviceId];
  });
  queryLatestHeartbeatByDeviceMock.mockImplementation(async ({ deviceId }) => {
    return heartbeats[deviceId] ?? makeHeartbeat(deviceId);
  });
  queryActivitiesByDeviceAndRangeMock.mockImplementation(
    async ({ deviceId }) => {
      return activities[deviceId] ?? [];
    },
  );
};

const findEvaluation = (deviceId: string) =>
  updateMonitorEvaluationMock.mock.calls
    .map(([record]) => record as MonitorStateMock)
    .find((record) => record.deviceId === deviceId);

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

    devices.splice(
      0,
      devices.length,
      { id: "device01", label: "デバイス1" },
      { id: "device02", label: "デバイス2" },
    );

    getMonitorStateByDeviceMock.mockReset();
    queryActivitiesByDeviceAndRangeMock.mockReset();
    queryLatestHeartbeatByDeviceMock.mockReset();
    sendMock.mockReset();
    updateMonitorEvaluationMock.mockReset();
    fetchMock.mockReset();

    sendMock.mockResolvedValue(undefined);
    updateMonitorEvaluationMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    mockScenario();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not notify on the sixth consecutive house-level non-detection", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 5,
        },
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findEvaluation(HOUSE_MOTION_MONITOR_STATE_ID)).toEqual(
      expect.objectContaining({
        deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
        isHealthy: true,
        consecutiveNonDetectionCount: 6,
        activityTotal: 0,
      }),
    );
  });

  it("notifies abnormal on the seventh consecutive house-level non-detection", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findEvaluation(HOUSE_MOTION_MONITOR_STATE_ID)).toEqual(
      expect.objectContaining({
        deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
        isHealthy: false,
        consecutiveNonDetectionCount: 7,
        activityTotal: 0,
      }),
    );

    const published = parsePublishedMessage(0);
    expect(published.content?.title).toBe("異常発生");
    expect(published.content?.description).toContain("家全体");
    expect(published.content?.description).toContain("直近10分で2回以上で生存");
  });

  it("notifies recovery when house motion becomes alive after an abnormal state", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: false,
          consecutiveNonDetectionCount: 7,
        },
      },
      activities: {
        device01: [makeActivity("device01", 1)],
        device02: [makeActivity("device02", 1)],
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findEvaluation(HOUSE_MOTION_MONITOR_STATE_ID)).toEqual(
      expect.objectContaining({
        deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
        isHealthy: true,
        consecutiveNonDetectionCount: 0,
        activityTotal: 2,
      }),
    );

    const published = parsePublishedMessage(0);
    expect(published.content?.title).toBe("正常復旧");
    expect(published.content?.description).toContain("家全体");
  });

  it("keeps house motion healthy when one device has zero motion and another has sufficient motion", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
      },
      activities: {
        device01: [],
        device02: [makeActivity("device02", 2)],
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findEvaluation(HOUSE_MOTION_MONITOR_STATE_ID)).toEqual(
      expect.objectContaining({
        deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
        isHealthy: true,
        consecutiveNonDetectionCount: 0,
        activityTotal: 2,
      }),
    );
  });

  it("keeps motion notifications house-level only", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
        device01: {
          deviceId: "device01",
          isHealthy: true,
        },
        device02: {
          deviceId: "device02",
          isHealthy: true,
        },
      },
    });

    await handler({} as never, {} as never, vi.fn());

    const published = parsePublishedMessage(0);
    expect(published.content?.description).toContain("家全体");
    expect(published.content?.description).not.toContain("デバイス1");
    expect(published.content?.description).not.toContain("デバイス2");
  });

  it("notifies a per-device heartbeat abnormal even when house motion is healthy", async () => {
    mockScenario({
      previousStates: {
        device01: {
          deviceId: "device01",
          isHealthy: true,
          reason: "正常",
        },
      },
      heartbeats: {
        device01: makeHeartbeat("device01", {
          timestamp: "2026-06-07T00:55:00.000Z",
          createdAt: "2026-06-07T00:55:00.000Z",
        }),
      },
      activities: {
        device02: [makeActivity("device02", 2)],
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findEvaluation("device01")).toEqual(
      expect.objectContaining({
        deviceId: "device01",
        isHealthy: false,
      }),
    );

    const published = parsePublishedMessage(0);
    expect(published.content?.description).toContain("デバイス1");
    expect(published.content?.description).not.toContain("家全体: 異常発生");
  });

  it("uses the last closed 10-minute window for every device", async () => {
    vi.setSystemTime(new Date("2026-06-07T01:10:42.000Z"));

    mockScenario({
      activities: {
        device01: [makeActivity("device01", 1)],
        device02: [makeActivity("device02", 2)],
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(queryActivitiesByDeviceAndRangeMock).toHaveBeenCalledTimes(2);
    expect(queryActivitiesByDeviceAndRangeMock).toHaveBeenNthCalledWith(1, {
      deviceId: "device01",
      from: "2026-06-07T01:00:00.000Z",
      to: "2026-06-07T01:10:00.000Z",
    });
    expect(queryActivitiesByDeviceAndRangeMock).toHaveBeenNthCalledWith(2, {
      deviceId: "device02",
      from: "2026-06-07T01:00:00.000Z",
      to: "2026-06-07T01:10:00.000Z",
    });
  });

  it("skips notifications outside the JST notification window", async () => {
    vi.setSystemTime(new Date("2026-06-07T15:10:00.000Z"));

    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findEvaluation(HOUSE_MOTION_MONITOR_STATE_ID)).toEqual(
      expect.objectContaining({
        isHealthy: false,
        consecutiveNonDetectionCount: 7,
      }),
    );
  });

  it("sends notifications during the 23 JST hour", async () => {
    vi.setSystemTime(new Date("2026-06-07T14:10:00.000Z"));

    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parsePublishedMessage(0).content?.title).toBe("異常発生");
  });

  it("sends abnormal and recovery notifications separately when both happen in one run", async () => {
    mockScenario({
      previousStates: {
        device01: {
          deviceId: "device01",
          isHealthy: true,
          reason: "正常",
        },
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: false,
          consecutiveNonDetectionCount: 7,
        },
      },
      heartbeats: {
        device01: makeHeartbeat("device01", {
          timestamp: "2026-06-07T00:55:00.000Z",
          createdAt: "2026-06-07T00:55:00.000Z",
        }),
      },
      activities: {
        device02: [makeActivity("device02", 2)],
      },
    });

    await handler({} as never, {} as never, vi.fn());

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const publishedTitles = sendMock.mock.calls.map(([command]) => {
      const input = command as { input?: { Message?: string } };
      return JSON.parse(input.input?.Message ?? "{}").content?.title;
    });
    expect(publishedTitles).toEqual(["異常発生", "正常復旧"]);
  });

  it("persists the new state before notification delivery fails", async () => {
    mockScenario({
      previousStates: {
        [HOUSE_MOTION_MONITOR_STATE_ID]: {
          deviceId: HOUSE_MOTION_MONITOR_STATE_ID,
          isHealthy: true,
          consecutiveNonDetectionCount: 6,
        },
      },
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
    expect(updateMonitorEvaluationMock).toHaveBeenCalledTimes(3);
  });
});
