import {
  DEVICES,
  getDefaultDevice,
  getDeviceById,
  type DeviceConfig,
} from "@home-presence-monitor/config/device";

export const resolveSelectedDevice = (
  requestedDeviceId: string | null | undefined,
): DeviceConfig => {
  if (requestedDeviceId) {
    const device = getDeviceById(requestedDeviceId);
    if (device) {
      return device;
    }
  }

  return getDefaultDevice();
};

export const buildDeviceDetailPath = (
  pathname: string,
  deviceId: string,
): string => {
  const params = new URLSearchParams({
    deviceId,
  });

  return `${pathname}?${params.toString()}`;
};

export const hasMultipleDevices = (): boolean => DEVICES.length > 1;
