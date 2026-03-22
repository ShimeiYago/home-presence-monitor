import { Hono } from "hono";
import { deviceParamsSchema } from "./common";
import { parseParams } from "src/app/lib/zod";
import { GetActivitiesResponse } from "@homePresenceMonitor/contracts/api";

export const deviceActivitiesRoute = new Hono();

deviceActivitiesRoute.get("/latest", async (c) => {
    const { deviceId } = parseParams(c, deviceParamsSchema);

    return c.json<GetActivitiesResponse>({
        deviceId,
        // TODO: Implement the actual logic to retrieve the activities for the device
        activities: []
    }, 200);
});
