import type { Context } from "hono";
import z from "zod";
import { isKnownDeviceId } from "@home-presence-monitor/config/device";
import { notFound } from "src/app/lib/errors";
import { parseParams } from "src/app/lib/zod";

export const deviceParamsSchema = z.object({
  deviceId: z.string().min(1).max(255),
});

export const parseKnownDeviceId = (c: Context): string => {
  const { deviceId } = parseParams(c, deviceParamsSchema);

  if (!isKnownDeviceId(deviceId)) {
    throw notFound(`Device not found: ${deviceId}`);
  }

  return deviceId;
};
