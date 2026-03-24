"use client";

import { PRESET_LABELS, type PresetKey } from "@/lib/time-range";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TimeRangeFilterProps = {
  value: PresetKey;
  onChange: (value: PresetKey) => void;
  disabled?: boolean;
};

export function TimeRangeFilter({
  value,
  onChange,
  disabled = false,
}: TimeRangeFilterProps) {
  return (
    <div className="grid w-full max-w-xs gap-2">
      <p className="text-sm font-medium text-slate-700">時間範囲</p>
      <Select
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as PresetKey)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1h">{PRESET_LABELS["1h"]}</SelectItem>
          <SelectItem value="6h">{PRESET_LABELS["6h"]}</SelectItem>
          <SelectItem value="24h">{PRESET_LABELS["24h"]}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
