export type DeviceConfig = {
  id: string;
  name: string;
};

export const DEVICES = [
  {
    id: "device01",
    name: "ラズパイ01",
  },
  {
    id: "device02",
    name: "ラズパイ02",
  },
] as const satisfies readonly DeviceConfig[];

export const DEVICE_IDS = DEVICES.map((device) => device.id);

export const getDeviceById = (deviceId: string): DeviceConfig | undefined =>
  DEVICES.find((device) => device.id === deviceId);

export const isKnownDeviceId = (deviceId: string): boolean =>
  getDeviceById(deviceId) !== undefined;

export const getDefaultDevice = (): DeviceConfig => {
  const device = DEVICES[0];

  if (!device) {
    throw new Error("No devices configured");
  }

  return device;
};

export const getDeviceLabel = (deviceId: string): string => {
  const device = getDeviceById(deviceId);
  return device ? `${device.name} (${device.id})` : deviceId;
};
