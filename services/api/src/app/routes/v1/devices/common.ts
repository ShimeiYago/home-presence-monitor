import z from "zod";

export const deviceParamsSchema = z.object({
  deviceId: z.string().min(1).max(255),
});
