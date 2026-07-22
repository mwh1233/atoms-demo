"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PreviewDevice = "desktop" | "tablet" | "mobile";

type DeviceFrameProps = {
  device: PreviewDevice;
  children: ReactNode;
};

const frameWidths: Record<PreviewDevice, string> = {
  desktop: "w-full",
  tablet: "w-[768px] max-w-full",
  mobile: "w-[375px] max-w-full"
};

export function DeviceFrame({ device, children }: DeviceFrameProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 justify-center overflow-auto bg-background p-4">
      <div
        className={cn(
          "h-full min-h-0 overflow-hidden rounded-lg border border-border/80 bg-[#0f172a] shadow-2xl shadow-black/30 ring-1 ring-white/5 transition-all duration-300",
          frameWidths[device]
        )}
      >
        {children}
      </div>
    </div>
  );
}
