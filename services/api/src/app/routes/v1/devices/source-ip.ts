import { Hono } from "hono";
import { GetDeviceSourceIpResponse } from "@home-presence-monitor/contracts/api";
import { getMonitorStateByDevice } from "@home-presence-monitor/db/schema/monitor-states";
import { notFound } from "src/app/lib/errors";
import { parseConfiguredDevice } from "./common";

export const deviceSourceIpRoute = new Hono();

deviceSourceIpRoute.get("/", async (c) => {
  const { id: deviceId } = parseConfiguredDevice(c);
  const monitorState = await getMonitorStateByDevice({ deviceId });

  if (
    !monitorState?.lastObservedSourceIp ||
    !monitorState.lastObservedSourceIpAt
  ) {
    throw notFound("Latest observed source IP not found");
  }

  return c.json<GetDeviceSourceIpResponse>(
    {
      deviceId,
      sourceIp: monitorState.lastObservedSourceIp,
      observedAt: monitorState.lastObservedSourceIpAt,
    },
    200,
  );
});
