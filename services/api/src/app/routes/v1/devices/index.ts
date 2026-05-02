import { Hono } from "hono";
import { deviceHeartbeatsRoute } from "./heartbeats";
import { deviceActivitiesRoute } from "./activities";
import { deviceSourceIpRoute } from "./source-ip";

export const devicesRoute = new Hono();
const deviceRoute = new Hono();

deviceRoute.route("/heartbeats", deviceHeartbeatsRoute);
deviceRoute.route("/activities", deviceActivitiesRoute);
deviceRoute.route("/source-ip", deviceSourceIpRoute);

devicesRoute.route("/:deviceId", deviceRoute);
