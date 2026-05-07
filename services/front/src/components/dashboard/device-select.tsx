"use client";

import { DEVICES } from "@home-presence-monitor/config/device";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DeviceSelectProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function DeviceSelect({
  value,
  onChange,
  disabled = false,
}: DeviceSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="device-select">Device</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id="device-select"
          className="w-full border-slate-300 bg-white"
        >
          <SelectValue placeholder="Device を選択" />
        </SelectTrigger>
        <SelectContent>
          {DEVICES.map((device) => (
            <SelectItem key={device.id} value={device.id}>
              {device.name} ({device.id})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
