import devicesConfig from "./devices.json";

export const DEVICES = devicesConfig.devices;

export type DeviceConfig = (typeof DEVICES)[number];
export type DeviceId = DeviceConfig["id"];

export const DEVICE_IDS: DeviceId[] = DEVICES.map((device) => device.id);

export const DEFAULT_DEVICE_ID: DeviceId = DEVICES[0].id;

export const L03E_RESTART_OWNER_DEVICE_ID =
  devicesConfig.l03eRestartOwnerDeviceId as DeviceId;

export const L03E_CONFIG = devicesConfig.l03e;

export const getDeviceById = (deviceId: string): DeviceConfig | undefined =>
  DEVICES.find((device) => device.id === deviceId);

export const isConfiguredDeviceId = (deviceId: string): deviceId is DeviceId =>
  getDeviceById(deviceId) !== undefined;

export const getDeviceLabel = (deviceId: string): string =>
  getDeviceById(deviceId)?.label ?? deviceId;
