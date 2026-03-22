import { Hono } from "hono";
import { z } from "zod";
import { parseParams } from "src/app/lib/zod";
import { GetLatestHeartbeatResponse } from "@homePresenceMonitor/contracts/api";
import { deviceParamsSchema } from "./common";

export const deviceHeartbeatsRoute = new Hono();

deviceHeartbeatsRoute.get("/latest", async (c) => {
  const { deviceId } = parseParams(c, deviceParamsSchema);

  return c.json<GetLatestHeartbeatResponse>(
    {
      deviceId,
      // TODO: Implement the actual logic to retrieve the last heartbeat timestamp for the device
      lastHeartbeatAt: "2024-01-01T00:00:00Z",
    },
    200,
  );
});
