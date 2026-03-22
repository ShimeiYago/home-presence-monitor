import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbDocClient, getTableName } from "../ddb";
import { isRecord, readNumber, readString } from "../guards";

export type ActivityRecord = {
  deviceId: string;
  windowStart: string;
  windowEnd: string;
  motionCount: number;
  createdAt: string;
  ttl: number;
};

export type ActivityItem = {
  PK: string;
  SK: string;
  deviceId: string;
  windowStart: string;
  windowEnd: string;
  motionCount: number;
  createdAt: string;
  ttl: number;
};

const DEVICE_PK_PREFIX = "DEVICE#";
const ACTIVITY_SK_PREFIX = "ACTIVITY#";

export const buildActivityPk = (deviceId: string): string =>
  `${DEVICE_PK_PREFIX}${deviceId}`;

export const buildActivitySk = (windowStart: string): string =>
  `${ACTIVITY_SK_PREFIX}${windowStart}`;

const parseDeviceIdFromPk = (pk: string): string | undefined => {
  const match = pk.match(/^DEVICE#(.+)$/);
  return match?.[1];
};

const parseWindowStartFromSk = (sk: string): string | undefined => {
  const match = sk.match(/^ACTIVITY#(.+)$/);
  return match?.[1];
};

export const parseActivityRecord = (item: unknown): ActivityRecord | undefined => {
  if (!isRecord(item)) {
    return undefined;
  }

  const pk = readString(item, "PK");
  const sk = readString(item, "SK");
  const deviceId = readString(item, "deviceId");
  const windowStart = readString(item, "windowStart");
  const windowEnd = readString(item, "windowEnd");
  const motionCount = readNumber(item, "motionCount");
  const createdAt = readString(item, "createdAt");
  const ttl = readNumber(item, "ttl");

  if (
    !pk ||
    !sk ||
    !deviceId ||
    !windowStart ||
    !windowEnd ||
    motionCount === undefined ||
    !createdAt ||
    ttl === undefined
  ) {
    return undefined;
  }

  const parsedDeviceId = parseDeviceIdFromPk(pk);
  const parsedWindowStart = parseWindowStartFromSk(sk);

  if (!parsedDeviceId || !parsedWindowStart) {
    return undefined;
  }

  if (deviceId !== parsedDeviceId || windowStart !== parsedWindowStart) {
    return undefined;
  }

  return {
    deviceId,
    windowStart,
    windowEnd,
    motionCount,
    createdAt,
    ttl,
  };
};

export const buildActivityItem = (record: ActivityRecord): ActivityItem => ({
  PK: buildActivityPk(record.deviceId),
  SK: buildActivitySk(record.windowStart),
  deviceId: record.deviceId,
  windowStart: record.windowStart,
  windowEnd: record.windowEnd,
  motionCount: record.motionCount,
  createdAt: record.createdAt,
  ttl: record.ttl,
});

export const putActivity = async (record: ActivityRecord): Promise<void> => {
  await getDdbDocClient().send(
    new PutCommand({
      TableName: getTableName("ACTIVITIES"),
      Item: buildActivityItem(record),
    }),
  );
};

export const queryActivitiesByDeviceAndRange = async (params: {
  deviceId: string;
  from: string;
  to: string;
}): Promise<ActivityRecord[]> => {
  const result = await getDdbDocClient().send(
    new QueryCommand({
      TableName: getTableName("ACTIVITIES"),
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :fromSk AND :toSk",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":pk": buildActivityPk(params.deviceId),
        ":fromSk": buildActivitySk(params.from),
        ":toSk": buildActivitySk(params.to),
      },
      ScanIndexForward: true,
    }),
  );

  const records: ActivityRecord[] = [];
  for (const item of result.Items ?? []) {
    const parsed = parseActivityRecord(item);
    if (parsed) {
      records.push(parsed);
    }
  }

  return records;
};
