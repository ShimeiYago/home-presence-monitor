export const DEVICES = [
  {
    id: "device01",
    label: "デバイス1",
  },
  {
    id: "device02",
    label: "デバイス2",
  },
] as const;

export type DeviceConfig = (typeof DEVICES)[number];
export type DeviceId = DeviceConfig["id"];

export const DEVICE_IDS: DeviceId[] = DEVICES.map((device) => device.id);

export const DEFAULT_DEVICE_ID: DeviceId = DEVICES[0].id;

export const getDeviceById = (deviceId: string): DeviceConfig | undefined =>
  DEVICES.find((device) => device.id === deviceId);

export const isConfiguredDeviceId = (deviceId: string): deviceId is DeviceId =>
  getDeviceById(deviceId) !== undefined;

export const getDeviceLabel = (deviceId: string): string =>
  getDeviceById(deviceId)?.label ?? deviceId;
