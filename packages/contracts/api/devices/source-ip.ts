import { ISO8601 } from "../common";

export type GetDeviceSourceIpResponse = {
  deviceId: string;
  sourceIp: string;
  observedAt: ISO8601;
};
