const JST_TIME_ZONE = "Asia/Tokyo";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const jstMinuteFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const jstHourFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST_TIME_ZONE,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

const toPartMap = (
  formatter: Intl.DateTimeFormat,
  date: Date,
): Record<string, string> =>
  Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

export const formatJstDateTimeMinute = (value: string): string => {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return "不正な時刻";
  }

  const map = toPartMap(jstMinuteFormatter, date);

  return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
};

export const formatJstHourMinute = (value: string): string => {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return "不正な時刻";
  }

  const map = toPartMap(jstMinuteFormatter, date);
  return `${map.hour}:${map.minute}`;
};

export const formatJstMonthDayHour = (value: string): string => {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return "不正な時刻";
  }

  const map = toPartMap(jstHourFormatter, date);
  return `${map.month}/${map.day} ${map.hour}:00`;
};

export const formatJstMonthDayHourMinute = (value: string): string => {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return "不正な時刻";
  }

  const map = toPartMap(jstMinuteFormatter, date);
  return `${map.month}/${map.day} ${map.hour}:${map.minute}`;
};

export const floorIsoToJstHour = (value: string): string => {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return value;
  }

  const bucketMs =
    Math.floor((timestampMs + JST_OFFSET_MS) / HOUR_MS) * HOUR_MS -
    JST_OFFSET_MS;
  return new Date(bucketMs).toISOString();
};

export const formatJstHourRange = (value: string): string => {
  const bucketStartMs = Date.parse(value);
  if (Number.isNaN(bucketStartMs)) {
    return "不正な時刻";
  }

  const startMap = toPartMap(jstMinuteFormatter, new Date(bucketStartMs));
  const endMap = toPartMap(
    jstMinuteFormatter,
    new Date(bucketStartMs + HOUR_MS - 60 * 1000),
  );

  return `${startMap.year}/${startMap.month}/${startMap.day} ${startMap.hour}:00 - ${endMap.hour}:${endMap.minute}`;
};

export const minutesSince = (value: string, nowMs = Date.now()): number => {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return Number.POSITIVE_INFINITY;
  }

  const deltaMs = nowMs - timestampMs;
  return Math.max(0, Math.floor(deltaMs / 60000));
};
