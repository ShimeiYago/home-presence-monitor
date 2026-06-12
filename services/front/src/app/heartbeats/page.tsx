"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Cpu } from "lucide-react";
import { TimeRangeFilter } from "@/components/dashboard/time-range-filter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchHeartbeats } from "@/lib/device-api";
import { DEVICES, resolveDeviceFromQueryParam } from "@/lib/devices";
import { resolveApiConfig, type ApiConfig } from "@/lib/runtime-config";
import { buildRange, type PresetKey } from "@/lib/time-range";
import { formatJstDateTimeMinute } from "@/lib/time";

type HeartbeatListItem = {
  timestamp: string;
};

export default function HeartbeatsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDevice = useMemo(
    () => resolveDeviceFromQueryParam(searchParams.get("deviceId")),
    [searchParams],
  );
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("1h");
  const [records, setRecords] = useState<HeartbeatListItem[]>([]);
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
          const response = await fetchHeartbeats(
            apiConfig.apiBaseUrl,
            apiConfig.apiKey,
            selectedDevice.id,
            buildRange(selectedPreset),
          );
          setRecords(response.heartbeats);
        } catch (error) {
          setRecords([]);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "heartbeats の取得に失敗しました。",
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
            <Cpu className="h-7 w-7 text-slate-700" />
            <span>ラズパイ状態</span>
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

        <Card className="space-y-4 rounded-2xl border-slate-200/80 p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">対象デバイス</p>
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

          <TimeRangeFilter
            value={selectedPreset}
            onChange={setSelectedPreset}
            disabled={isLoading}
          />
        </Card>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : records.length === 0 ? (
          <p className="rounded-xl border border-slate-200/80 bg-white p-4 text-sm text-slate-600">
            指定範囲に heartbeat 記録はありません。
          </p>
        ) : (
          <ul className="space-y-3">
            {records.map((record) => (
              <li
                key={record.timestamp}
                className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
              >
                <p className="text-xs text-slate-500">受信時刻</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatJstDateTimeMinute(record.timestamp)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
