import type { Context } from "hono";
import {
  getDeviceById,
  type DeviceConfig,
} from "@home-presence-monitor/config/device";
import { notFound } from "src/app/lib/errors";
import { parseParams } from "src/app/lib/zod";
import z from "zod";

export const deviceParamsSchema = z.object({
  deviceId: z.string().min(1).max(255),
});

export const parseConfiguredDevice = (c: Context): DeviceConfig => {
  const { deviceId } = parseParams(c, deviceParamsSchema);
  const device = getDeviceById(deviceId);

  if (!device) {
    throw notFound("Device not found");
  }

  return device;
};
