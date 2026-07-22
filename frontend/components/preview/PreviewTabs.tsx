"use client";

import { PreviewToolbar } from "@/components/preview/PreviewToolbar";
import type { PreviewDevice } from "@/components/preview/DeviceFrame";
import type { PreviewStatus } from "@/components/preview/CodePreview";
import { cn } from "@/lib/utils";

export type PreviewTab = "preview" | "editor";

type PreviewTabsProps = {
  activeTab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
  device: PreviewDevice;
  onDeviceChange: (device: PreviewDevice) => void;
  onRefresh: () => void;
  onDownload: () => void;
  onOpenNewTab: () => void;
  onFullscreen: () => void;
  status: PreviewStatus;
};

const tabs = [
  { value: "preview" as const, label: "效果" },
  { value: "editor" as const, label: "编辑器" }
];

export function PreviewTabs({
  activeTab,
  onTabChange,
  device,
  onDeviceChange,
  onRefresh,
  onDownload,
  onOpenNewTab,
  onFullscreen,
  status
}: PreviewTabsProps) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-secondary/60 px-3">
      <div className="flex h-12 items-center">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            className={cn(
              "relative flex h-12 items-center px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground",
              activeTab === tab.value && "text-sky-300"
            )}
            type="button"
            onClick={() => onTabChange(tab.value)}
          >
            {tab.label}
            {activeTab === tab.value ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-sky-500" />
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === "preview" ? (
        <PreviewToolbar
          compact
          device={device}
          status={status}
          onDeviceChange={onDeviceChange}
          onDownload={onDownload}
          onFullscreen={onFullscreen}
          onOpenNewTab={onOpenNewTab}
          onRefresh={onRefresh}
        />
      ) : null}
    </div>
  );
}
