import { ISO8601 } from "../common";

export type PostHeartbeatRequest = {
  timestamp: ISO8601;
};

export type PostHeartbeatResponse = {
  recordedAt: ISO8601;
};

export type GetLatestHeartbeatResponse = {
  deviceId: string;
  lastHeartbeatAt: ISO8601;
};

export type Heartbeat = {
  timestamp: ISO8601;
};

export type GetHeartbeatsQuery = {
  from: ISO8601;
  to: ISO8601;
};

export type GetHeartbeatsResponse = {
  deviceId: string;
  heartbeats: Heartbeat[];
};
