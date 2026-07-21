"use client";

import {
  Download,
  ExternalLink,
  Maximize2,
  Monitor,
  Smartphone,
  Tablet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PreviewDevice } from "@/components/preview/DeviceFrame";
import type { PreviewStatus } from "@/components/preview/CodePreview";

type PreviewToolbarProps = {
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  onDownload: () => void;
  onOpenNewTab: () => void;
  onFullscreen: () => void;
  status: PreviewStatus;
};

const devices = [
  { value: "desktop" as const, label: "桌面", icon: Monitor },
  { value: "tablet" as const, label: "平板", icon: Tablet },
  { value: "mobile" as const, label: "手机", icon: Smartphone }
];

const statusText: Record<PreviewStatus, string> = {
  loading: "加载中",
  success: "运行正常",
  error: "加载失败"
};

const statusClasses: Record<PreviewStatus, string> = {
  loading: "bg-sky-500/15 text-sky-200",
  success: "bg-emerald-500/15 text-emerald-200",
  error: "bg-red-500/15 text-red-200"
};

export function PreviewToolbar({
  device,
  onDeviceChange,
  onDownload,
  onOpenNewTab,
  onFullscreen,
  status
}: PreviewToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-secondary/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-background p-1">
          {devices.map((item) => (
            <Button
              key={item.value}
              className={cn(device === item.value && "bg-accent text-accent-foreground")}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => onDeviceChange(item.value)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Button>
          ))}
        </div>
        <span className={cn("rounded-md px-2 py-1 text-xs", statusClasses[status])}>
          {statusText[status]}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" type="button" variant="outline" onClick={onOpenNewTab}>
          <ExternalLink className="h-4 w-4" />
          新窗口
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={onDownload}>
          <Download className="h-4 w-4" />
          下载
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={onFullscreen}>
          <Maximize2 className="h-4 w-4" />
          全屏
        </Button>
      </div>
    </div>
  );
}
