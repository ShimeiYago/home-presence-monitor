export type PresetKey = "1h" | "6h" | "24h";

export type TimeRange = {
  from: string;
  to: string;
};

export const PRESET_HOURS: Record<PresetKey, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
};

export const PRESET_LABELS: Record<PresetKey, string> = {
  "1h": "1時間",
  "6h": "6時間",
  "24h": "24時間",
};

export const buildRange = (preset: PresetKey): TimeRange => {
  const to = new Date();
  const from = new Date(to.getTime() - PRESET_HOURS[preset] * 60 * 60 * 1000);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
};
