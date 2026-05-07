import { describe, expect, it } from "vitest";
import {
  buildDeviceDetailPath,
  hasMultipleDevices,
  resolveSelectedDevice,
} from "@/lib/device-selection";

describe("device selection helpers", () => {
  it("resolves configured devices and falls back for invalid ids", () => {
    expect(resolveSelectedDevice("device02")).toEqual({
      id: "device02",
      name: "デバイス02",
    });
    expect(resolveSelectedDevice("unknown-device")).toEqual({
      id: "device01",
      name: "デバイス01",
    });
    expect(resolveSelectedDevice(null)).toEqual({
      id: "device01",
      name: "デバイス01",
    });
  });

  it("builds device detail urls", () => {
    expect(buildDeviceDetailPath("/heartbeats", "device02")).toBe(
      "/heartbeats?deviceId=device02",
    );
    expect(hasMultipleDevices()).toBe(true);
  });
});
