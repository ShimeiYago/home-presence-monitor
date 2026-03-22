import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbDocClient, getTableName } from "../ddb";
import { isRecord, readNumber, readString } from "../guards";

export type HeartbeatRecord = {
  deviceId: string;
  timestamp: string;
  createdAt: string;
  ttl: number;
};

export type HeartbeatItem = {
  PK: string;
  SK: string;
  deviceId: string;
  timestamp: string;
  createdAt: string;
  ttl: number;
};

const DEVICE_PK_PREFIX = "DEVICE#";
const HEARTBEAT_SK_PREFIX = "HEARTBEAT#";

export const buildHeartbeatPk = (deviceId: string): string =>
  `${DEVICE_PK_PREFIX}${deviceId}`;

export const buildHeartbeatSk = (timestamp: string): string =>
  `${HEARTBEAT_SK_PREFIX}${timestamp}`;

const parseDeviceIdFromPk = (pk: string): string | undefined => {
  const match = pk.match(/^DEVICE#(.+)$/);
  return match?.[1];
};

const parseTimestampFromSk = (sk: string): string | undefined => {
  const match = sk.match(/^HEARTBEAT#(.+)$/);
  return match?.[1];
};

export const parseHeartbeatRecord = (
  item: unknown,
): HeartbeatRecord | undefined => {
  if (!isRecord(item)) {
    return undefined;
  }

  const pk = readString(item, "PK");
  const sk = readString(item, "SK");
  const deviceId = readString(item, "deviceId");
  const timestamp = readString(item, "timestamp");
  const createdAt = readString(item, "createdAt");
  const ttl = readNumber(item, "ttl");

  if (
    !pk ||
    !sk ||
    !deviceId ||
    !timestamp ||
    !createdAt ||
    ttl === undefined
  ) {
    return undefined;
  }

  const parsedDeviceId = parseDeviceIdFromPk(pk);
  const parsedTimestamp = parseTimestampFromSk(sk);

  if (!parsedDeviceId || !parsedTimestamp) {
    return undefined;
  }

  if (deviceId !== parsedDeviceId || timestamp !== parsedTimestamp) {
    return undefined;
  }

  return {
    deviceId,
    timestamp,
    createdAt,
    ttl,
  };
};

export const buildHeartbeatItem = (record: HeartbeatRecord): HeartbeatItem => ({
  PK: buildHeartbeatPk(record.deviceId),
  SK: buildHeartbeatSk(record.timestamp),
  deviceId: record.deviceId,
  timestamp: record.timestamp,
  createdAt: record.createdAt,
  ttl: record.ttl,
});

export const putHeartbeat = async (record: HeartbeatRecord): Promise<void> => {
  await getDdbDocClient().send(
    new PutCommand({
      TableName: getTableName("HEARTBEATS"),
      Item: buildHeartbeatItem(record),
    }),
  );
};

export const queryLatestHeartbeatByDevice = async (params: {
  deviceId: string;
}): Promise<HeartbeatRecord | undefined> => {
  const result = await getDdbDocClient().send(
    new QueryCommand({
      TableName: getTableName("HEARTBEATS"),
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": buildHeartbeatPk(params.deviceId),
        ":skPrefix": HEARTBEAT_SK_PREFIX,
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const item = result.Items?.[0];
  return item ? parseHeartbeatRecord(item) : undefined;
};
