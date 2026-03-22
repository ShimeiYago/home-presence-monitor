import { Hono } from "hono";
import { z } from "zod";
import {
  GetLatestHeartbeatResponse,
  PostHeartbeatRequest,
  PostHeartbeatResponse,
} from "@home-presence-monitor/contracts/api";
import {
  putHeartbeat,
  queryLatestHeartbeatByDevice,
} from "@home-presence-monitor/db/schema/heartbeats";
import { notFound } from "src/app/lib/errors";
import { parseJsonBody, parseParams } from "src/app/lib/zod";
import { deviceParamsSchema } from "./common";

export const deviceHeartbeatsRoute = new Hono();
const HEARTBEAT_TTL_SECONDS = 60 * 60 * 24;
const postHeartbeatRequestSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
});
const toTtlEpoch = (createdAt: string, ttlSeconds: number): number =>
  Math.floor(Date.parse(createdAt) / 1000) + ttlSeconds;

deviceHeartbeatsRoute.get("/latest", async (c) => {
  const { deviceId } = parseParams(c, deviceParamsSchema);
  const latestHeartbeat = await queryLatestHeartbeatByDevice({ deviceId });

  if (!latestHeartbeat) {
    throw notFound("Latest heartbeat not found");
  }

  return c.json<GetLatestHeartbeatResponse>(
    {
      deviceId,
      lastHeartbeatAt: latestHeartbeat.timestamp,
    },
    200,
  );
});

deviceHeartbeatsRoute.post("/", async (c) => {
  const { deviceId } = parseParams(c, deviceParamsSchema);
  const body = await parseJsonBody<PostHeartbeatRequest>(
    c,
    postHeartbeatRequestSchema,
  );
  const createdAt = new Date().toISOString();
  const ttl = toTtlEpoch(createdAt, HEARTBEAT_TTL_SECONDS);

  await putHeartbeat({
    deviceId,
    timestamp: body.timestamp,
    createdAt,
    ttl,
  });

  return c.json<PostHeartbeatResponse>(
    {
      recordedAt: createdAt,
    },
    201,
  );
});
