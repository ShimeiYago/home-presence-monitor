"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity as ActivityIcon, ArrowLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Activity } from "@home-presence-monitor/contracts/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchActivities } from "@/lib/device-api";
import { DEVICES, resolveDeviceFromQueryParam } from "@/lib/devices";
import { resolveApiConfig, type ApiConfig } from "@/lib/runtime-config";
import type { TimeRange } from "@/lib/time-range";
import {
  floorIsoToJstHour,
  formatJstDateTimeMinute,
  formatJstHourMinute,
  formatJstHourRange,
  formatJstMonthDayHour,
} from "@/lib/time";

type ActivityRangePreset = "6h" | "12h" | "24h" | "3d";

type ActivityChartDatum = {
  bucketStart: string;
  bucketEnd: string;
  motionCount: number;
  xLabel: string;
  tooltipLabel: string;
};

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const JST_OFFSET_MS = 9 * HOUR_MS;

const floorIsoToJstMinutes = (value: string, bucketMinutes: number): string => {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    return value;
  }

  const bucketMs = bucketMinutes * MINUTE_MS;
  return new Date(
    Math.floor((timestampMs + JST_OFFSET_MS) / bucketMs) * bucketMs -
      JST_OFFSET_MS,
  ).toISOString();
};

const ACTIVITY_PRESET_HOURS: Record<ActivityRangePreset, number> = {
  "6h": 6,
  "12h": 12,
  "24h": 24,
  "3d": 72,
};

const ACTIVITY_PRESET_LABELS: Record<ActivityRangePreset, string> = {
  "6h": "6時間",
  "12h": "12時間",
  "24h": "24時間",
  "3d": "3日",
};

const ACTIVITY_PRESET_OPTIONS: ActivityRangePreset[] = [
  "6h",
  "12h",
  "24h",
  "3d",
];

const buildActivityRange = (preset: ActivityRangePreset): TimeRange => {
  const to = new Date();
  const from = new Date(
    to.getTime() - ACTIVITY_PRESET_HOURS[preset] * 60 * 60 * 1000,
  );

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
};

const buildChartData = (
  records: Activity[],
  preset: ActivityRangePreset,
): ActivityChartDatum[] => {
  const sorted = [...records].sort((a, b) =>
    a.windowStart.localeCompare(b.windowStart),
  );

  if (preset === "6h" || preset === "12h") {
    return sorted.map((record) => ({
      bucketStart: record.windowStart,
      bucketEnd: record.windowEnd,
      motionCount: record.motionCount,
      xLabel: formatJstHourMinute(record.windowStart),
      tooltipLabel: `${formatJstDateTimeMinute(record.windowStart)} - ${formatJstHourMinute(record.windowEnd)}`,
    }));
  }

  if (preset === "24h") {
    const buckets = new Map<string, number>();
    for (const record of sorted) {
      const bucketStart = floorIsoToJstMinutes(record.windowStart, 30);
      buckets.set(
        bucketStart,
        (buckets.get(bucketStart) ?? 0) + record.motionCount,
      );
    }

    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucketStart, motionCount]) => {
        const bucketEnd = new Date(
          Date.parse(bucketStart) + 30 * MINUTE_MS,
        ).toISOString();

        return {
          bucketStart,
          bucketEnd,
          motionCount,
          xLabel: formatJstHourMinute(bucketStart),
          tooltipLabel: `${formatJstDateTimeMinute(bucketStart)} - ${formatJstHourMinute(bucketEnd)}`,
        };
      });
  }

  const buckets = new Map<string, number>();
  for (const record of sorted) {
    const bucketStart = floorIsoToJstHour(record.windowStart);
    buckets.set(
      bucketStart,
      (buckets.get(bucketStart) ?? 0) + record.motionCount,
    );
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucketStart, motionCount]) => ({
      bucketStart,
      bucketEnd: new Date(Date.parse(bucketStart) + HOUR_MS).toISOString(),
      motionCount,
      xLabel: formatJstMonthDayHour(bucketStart),
      tooltipLabel: formatJstHourRange(bucketStart),
    }));
};

const resolveChartScaleMax = (chartData: ActivityChartDatum[]): number => {
  const firstDatum = chartData[0];
  if (!firstDatum) {
    return 10;
  }

  const bucketDurationMinutes = Math.max(
    1,
    Math.round(
      (Date.parse(firstDatum.bucketEnd) - Date.parse(firstDatum.bucketStart)) /
        MINUTE_MS,
    ),
  );

  return bucketDurationMinutes;
};

const buildYAxisTicks = (chartScaleMax: number): number[] => {
  if (chartScaleMax <= 10) {
    return Array.from({ length: chartScaleMax + 1 }, (_, index) => index);
  }

  const ticks: number[] = [];
  for (let value = 0; value < chartScaleMax; value += 10) {
    ticks.push(value);
  }
  ticks.push(chartScaleMax);

  return ticks;
};

function ActivityChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload: ActivityChartDatum }>;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-sm font-medium text-slate-900">{datum.tooltipLabel}</p>
      <p className="mt-1 text-sm text-slate-600">
        センサー検知回数:{" "}
        <span className="font-semibold text-slate-900">
          {datum.motionCount}回
        </span>
      </p>
    </div>
  );
}

export default function ActivitiesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDevice = useMemo(
    () => resolveDeviceFromQueryParam(searchParams.get("deviceId")),
    [searchParams],
  );
  const [selectedPreset, setSelectedPreset] =
    useState<ActivityRangePreset>("6h");
  const [records, setRecords] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiConfig = useMemo<ApiConfig>(() => resolveApiConfig(), []);

  const isApiConfigured = Boolean(apiConfig.apiBaseUrl && apiConfig.apiKey);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void (async () => {
        if (!apiConfig.apiBaseUrl) {
          setErrorMessage("NEXT_PUBLIC_API_BASE_URL が設定されていません。");
          return;
        }
        if (!apiConfig.apiKey) {
          setErrorMessage("NEXT_PUBLIC_API_KEY が設定されていません。");
          return;
        }

        setIsLoading(true);
        setErrorMessage(null);

        try {
          const response = await fetchActivities(
            apiConfig.apiBaseUrl,
            apiConfig.apiKey,
            selectedDevice.id,
            buildActivityRange(selectedPreset),
          );
          setRecords(response.activities);
        } catch (error) {
          setRecords([]);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "activities の取得に失敗しました。",
          );
        } finally {
          setIsLoading(false);
        }
      })();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    apiConfig.apiBaseUrl,
    apiConfig.apiKey,
    selectedDevice.id,
    selectedPreset,
  ]);

  const chartData = useMemo<ActivityChartDatum[]>(
    () => buildChartData(records, selectedPreset),
    [records, selectedPreset],
  );
  const chartScaleMax = useMemo<number>(
    () => resolveChartScaleMax(chartData),
    [chartData],
  );
  const displayChartData = useMemo<
    Array<ActivityChartDatum & { chartMotionCount: number }>
  >(
    () =>
      chartData.map((datum) => ({
        ...datum,
        chartMotionCount: Math.min(datum.motionCount, chartScaleMax),
      })),
    [chartData, chartScaleMax],
  );
  const yAxisTicks = useMemo<number[]>(
    () => buildYAxisTicks(chartScaleMax),
    [chartScaleMax],
  );

  const handleDeviceChange = (deviceId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("deviceId", deviceId);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-8 text-slate-900 sm:px-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            ダッシュボードに戻る
          </Link>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <ActivityIcon className="h-7 w-7 text-slate-700" />
            <span>センサー記録</span>
          </h1>
          <p className="text-sm text-slate-600">
            表示中: {selectedDevice.label} ({selectedDevice.id})
          </p>
        </header>

        {!isApiConfigured && (
          <Alert variant="destructive">
            <AlertTitle>API設定エラー</AlertTitle>
            <AlertDescription>
              `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_KEY` または
              `/runtime-config.js` を設定してください。
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>取得エラー</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Card className="rounded-2xl border-slate-200/80 bg-white/90">
          <CardHeader className="gap-4 p-4">
            <div className="space-y-2">
              <CardTitle className="text-base font-semibold text-slate-900">
                対象デバイス
              </CardTitle>
              <Select
                value={selectedDevice.id}
                onValueChange={handleDeviceChange}
                disabled={isLoading}
              >
                <SelectTrigger className="border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="デバイスを選択" />
                </SelectTrigger>
                <SelectContent>
                  {DEVICES.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.label} ({device.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <CardTitle className="text-base font-semibold text-slate-900">
                表示期間
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {ACTIVITY_PRESET_OPTIONS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={selectedPreset === preset ? "default" : "outline"}
                    className={
                      selectedPreset === preset
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }
                    disabled={isLoading}
                    onClick={() => setSelectedPreset(preset)}
                  >
                    {ACTIVITY_PRESET_LABELS[preset]}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-[360px] w-full rounded-2xl" />
          </div>
        ) : (
          <Card className="rounded-2xl border-slate-200/80 bg-white/95">
            <CardHeader className="gap-2 p-4">
              <CardTitle className="text-base font-semibold text-slate-900">
                時間帯ごとのセンサー検知
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {chartData.length === 0 ? (
                <p className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 text-sm text-slate-600">
                  指定範囲に activity 記録はありません。
                </p>
              ) : (
                <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={displayChartData}
                      margin={{ top: 16, right: 12, left: 0, bottom: 12 }}
                      barCategoryGap={selectedPreset === "6h" ? "20%" : "8%"}
                    >
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="xLabel"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={selectedPreset === "6h" ? 20 : 32}
                        tick={{ fill: "#475569", fontSize: 12 }}
                      />
                      <YAxis
                        domain={[0, chartScaleMax]}
                        ticks={yAxisTicks}
                        interval={0}
                        tickFormatter={(value: number) =>
                          value >= chartScaleMax
                            ? `${chartScaleMax}以上`
                            : String(value)
                        }
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        label={{
                          value: "検知回数",
                          angle: -90,
                          position: "insideLeft",
                          style: {
                            textAnchor: "middle",
                            fill: "#475569",
                            fontSize: 12,
                          },
                        }}
                        tick={{ fill: "#475569", fontSize: 12 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(148, 163, 184, 0.14)" }}
                        content={<ActivityChartTooltip />}
                      />
                      <Bar
                        dataKey="chartMotionCount"
                        name="検知回数"
                        fill="#0f766e"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
