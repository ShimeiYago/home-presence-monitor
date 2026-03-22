import { Hono } from "hono";
import { deviceHeartbeatsRoute } from "./heartbeats";
import { deviceActivitiesRoute } from "./activities";

export const devicesRoute = new Hono();
const deviceRoute = new Hono();

deviceRoute.route("/heartbeats", deviceHeartbeatsRoute);
deviceRoute.route("/activities", deviceActivitiesRoute);

devicesRoute.route("/:deviceId", deviceRoute);
