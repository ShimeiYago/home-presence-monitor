"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  Activity,
  GetActivitiesResponse,
  GetLatestHeartbeatResponse,
} from "@home-presence-monitor/contracts/api";
import { DEVICE_IDS } from "@home-presence-monitor/config/device";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PresetKey = "1h" | "6h" | "24h";
type TimeRange = { from: string; to: string };
type ApiErrorShape = {
  error?: {
    message?: string;
  };
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "");
const PRESET_HOURS: Record<PresetKey, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
};

const buildRange = (preset: PresetKey): TimeRange => {
  const to = new Date();
  const from = new Date(to.getTime() - PRESET_HOURS[preset] * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
};

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));

const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as ApiErrorShape;
    if (data.error?.message) {
      return data.error.message;
    }
  } catch {
    // Fallback below
  }
  return `HTTP ${response.status}`;
};

const fetchActivities = async (
  baseUrl: string,
  deviceId: string,
  range: TimeRange,
): Promise<GetActivitiesResponse> => {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
  });

  const response = await fetch(
    `${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/activities?${params.toString()}`,
    { method: "GET", cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as GetActivitiesResponse;
};

const fetchLatestHeartbeat = async (
  baseUrl: string,
  deviceId: string,
): Promise<GetLatestHeartbeatResponse | null> => {
  const response = await fetch(
    `${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}/heartbeats/latest`,
    { method: "GET", cache: "no-store" },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as GetLatestHeartbeatResponse;
};

export default function Home() {
  const [selectedDevice, setSelectedDevice] = useState<string>(
    DEVICE_IDS[0] ?? "",
  );
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("1h");
  const [lastFetchedRange, setLastFetchedRange] = useState<TimeRange>(
    buildRange("1h"),
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [latestHeartbeatAt, setLatestHeartbeatAt] = useState<string | null>(
    null,
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalMotionCount = useMemo(
    () => activities.reduce((sum, row) => sum + row.motionCount, 0),
    [activities],
  );

  const refresh = useCallback(async () => {
    if (!API_BASE_URL) {
      setErrorMessage("NEXT_PUBLIC_API_BASE_URL が設定されていません。");
      return;
    }
    if (!selectedDevice) {
      setErrorMessage("deviceId が見つかりません。");
      return;
    }

    const range = buildRange(selectedPreset);
    setLastFetchedRange(range);
    setErrorMessage(null);
    setIsLoading(true);

    const [activitiesResult, heartbeatResult] = await Promise.allSettled([
      fetchActivities(API_BASE_URL, selectedDevice, range),
      fetchLatestHeartbeat(API_BASE_URL, selectedDevice),
    ]);

    const errors: string[] = [];

    if (activitiesResult.status === "fulfilled") {
      setActivities(activitiesResult.value.activities);
    } else {
      setActivities([]);
      errors.push(
        `Activities取得失敗: ${activitiesResult.reason instanceof Error ? activitiesResult.reason.message : String(activitiesResult.reason)}`,
      );
    }

    if (heartbeatResult.status === "fulfilled") {
      setLatestHeartbeatAt(heartbeatResult.value?.lastHeartbeatAt ?? null);
    } else {
      setLatestHeartbeatAt(null);
      errors.push(
        `Heartbeat取得失敗: ${heartbeatResult.reason instanceof Error ? heartbeatResult.reason.message : String(heartbeatResult.reason)}`,
      );
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join("\n"));
    } else {
      setLastUpdatedAt(new Date().toISOString());
    }

    setIsLoading(false);
  }, [selectedDevice, selectedPreset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200 px-4 py-8 text-slate-900 sm:px-6">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            活動検知モニター
          </h1>
          <p className="text-sm text-slate-600">
            API: {API_BASE_URL ?? "未設定"}
          </p>
        </header>

        {!API_BASE_URL && (
          <Alert variant="destructive">
            <AlertTitle>API設定エラー</AlertTitle>
            <AlertDescription>
              環境変数 `NEXT_PUBLIC_API_BASE_URL` を設定してください。
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>取得エラー</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>フィルター</CardTitle>
            <CardDescription>
              デバイスと時間範囲を選択して更新します。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="device-select">deviceId</Label>
              <Select
                value={selectedDevice}
                onValueChange={setSelectedDevice}
                disabled={isLoading || !selectedDevice}
              >
                <SelectTrigger id="device-select">
                  <SelectValue placeholder="deviceを選択" />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_IDS.map((deviceId) => (
                    <SelectItem key={deviceId} value={deviceId}>
                      {deviceId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="range-select">範囲プリセット</Label>
              <Select
                value={selectedPreset}
                onValueChange={(value) => setSelectedPreset(value as PresetKey)}
                disabled={isLoading}
              >
                <SelectTrigger id="range-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">直近1時間</SelectItem>
                  <SelectItem value="6h">直近6時間</SelectItem>
                  <SelectItem value="24h">直近24時間</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => void refresh()}
              disabled={isLoading || !API_BASE_URL}
            >
              <RefreshCw className={isLoading ? "animate-spin" : ""} />
              更新
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">最新Heartbeat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                <Skeleton className="h-5 w-48" />
              ) : latestHeartbeatAt ? (
                <>
                  <Badge>記録あり</Badge>
                  <p className="text-sm">
                    {formatTimestamp(latestHeartbeatAt)}
                  </p>
                </>
              ) : (
                <>
                  <Badge variant="secondary">未記録</Badge>
                  <p className="text-sm text-muted-foreground">
                    heartbeat はまだ登録されていません。
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Activities件数</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-semibold">{activities.length}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Motion合計</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <p className="text-3xl font-semibold">{totalMotionCount}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Activities</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">from {lastFetchedRange.from}</Badge>
              <Badge variant="outline">to {lastFetchedRange.to}</Badge>
              {lastUpdatedAt && (
                <span className="text-xs text-muted-foreground">
                  最終更新: {formatTimestamp(lastUpdatedAt)}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="from-display">from (UTC)</Label>
                <Input
                  id="from-display"
                  value={lastFetchedRange.from}
                  readOnly
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="to-display">to (UTC)</Label>
                <Input id="to-display" value={lastFetchedRange.to} readOnly />
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                該当時間帯の activity はありません。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>windowStart</TableHead>
                      <TableHead>windowEnd</TableHead>
                      <TableHead className="text-right">motionCount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activities.map((activity) => (
                      <TableRow
                        key={`${activity.windowStart}-${activity.windowEnd}-${activity.motionCount}`}
                      >
                        <TableCell>{activity.windowStart}</TableCell>
                        <TableCell>{activity.windowEnd}</TableCell>
                        <TableCell className="text-right">
                          {activity.motionCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
