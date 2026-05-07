import { describe, expect, it } from "vitest";
import {
  buildNotificationMessage,
  transitionFromPrevious,
  type TransitionNotification,
} from "./notifications";

describe("job notifications", () => {
  it("formats device labels as name and id", () => {
    const notifications: TransitionNotification[] = [
      {
        deviceId: "device01",
        transition: "正常→異常",
        current: {
          deviceId: "device01",
          isHealthy: false,
          reason: "heartbeat 未受信",
          activityTotal: 0,
        },
      },
      {
        deviceId: "device02",
        transition: "異常→正常",
        current: {
          deviceId: "device02",
          isHealthy: true,
          reason: "正常",
          activityTotal: 4,
        },
      },
    ];

    const message = buildNotificationMessage(
      notifications,
      "https://example.com/dashboard",
    );

    expect(message).toContain("デバイス01 (device01): 正常→異常");
    expect(message).toContain("デバイス02 (device02): 異常→正常");
  });

  it("keeps the expected transition rules", () => {
    expect(transitionFromPrevious(undefined, false)).toBe("初回異常");
    expect(transitionFromPrevious(true, false)).toBe("正常→異常");
    expect(transitionFromPrevious(false, true)).toBe("異常→正常");
    expect(transitionFromPrevious(true, true)).toBeUndefined();
  });
});
