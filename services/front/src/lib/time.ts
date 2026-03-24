const jstMinuteFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatJstDateTimeMinute = (value: string): string => {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return "不正な時刻";
  }

  const parts = jstMinuteFormatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
};

export const minutesSince = (value: string, nowMs = Date.now()): number => {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return Number.POSITIVE_INFINITY;
  }

  const deltaMs = nowMs - timestampMs;
  return Math.max(0, Math.floor(deltaMs / 60000));
};
