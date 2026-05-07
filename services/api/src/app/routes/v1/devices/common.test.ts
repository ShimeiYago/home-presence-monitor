import { describe, expect, it } from "vitest";
import {
  DEVICES,
  getDefaultDevice,
  getDeviceById,
  getDeviceLabel,
  isKnownDeviceId,
} from "@home-presence-monitor/config/device";

describe("device config helpers", () => {
  it("returns the configured devices", () => {
    expect(DEVICES).toHaveLength(2);
    expect(getDefaultDevice().id).toBe("device01");
  });

  it("looks up known devices and rejects unknown device ids", () => {
    expect(getDeviceById("device02")).toEqual({
      id: "device02",
      name: "デバイス02",
    });
    expect(isKnownDeviceId("device01")).toBe(true);
    expect(isKnownDeviceId("unknown-device")).toBe(false);
  });

  it("formats device labels for notifications", () => {
    expect(getDeviceLabel("device01")).toBe("デバイス01 (device01)");
    expect(getDeviceLabel("unknown-device")).toBe("unknown-device");
  });
});
