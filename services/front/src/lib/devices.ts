import {
  DEFAULT_DEVICE_ID,
  DEVICES,
  getDeviceById,
  type DeviceConfig,
  type DeviceId,
} from "@home-presence-monitor/config/devices";

const fallbackDevice = DEVICES[0];

export const resolveDeviceFromQueryParam = (
  deviceId: string | null | undefined,
): DeviceConfig => {
  const device = getDeviceById(deviceId ?? "");
  if (device) {
    return device;
  }

  if (!fallbackDevice) {
    throw new Error("No configured devices found");
  }

  return fallbackDevice;
};

export const resolveDeviceIdFromQueryParam = (
  deviceId: string | null | undefined,
): DeviceId => resolveDeviceFromQueryParam(deviceId).id;

export const buildDeviceDetailHref = (
  pathname: string,
  deviceId: string,
): string => `${pathname}?deviceId=${encodeURIComponent(deviceId)}`;

export { DEVICES, DEFAULT_DEVICE_ID };
