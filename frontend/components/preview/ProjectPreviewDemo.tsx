"use client";

import { useMemo, useRef, useState } from "react";
import { CodePreview, type PreviewStatus } from "@/components/preview/CodePreview";
import { PreviewToolbar } from "@/components/preview/PreviewToolbar";
import type { PreviewDevice } from "@/components/preview/DeviceFrame";

type ProjectPreviewDemoProps = {
  code: string;
};

export function ProjectPreviewDemo({ code }: ProjectPreviewDemoProps) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileName = useMemo(() => `atoms-preview-${Date.now()}.html`, []);

  function handleDownload() {
    const blob = new Blob([code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenNewTab() {
    const blob = new Blob([code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function handleFullscreen() {
    void containerRef.current?.requestFullscreen();
  }

  return (
    <div ref={containerRef} className="flex h-[620px] min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <PreviewToolbar
        device={device}
        status={status}
        onDeviceChange={setDevice}
        onDownload={handleDownload}
        onFullscreen={handleFullscreen}
        onOpenNewTab={handleOpenNewTab}
      />
      <CodePreview code={code} device={device} onStatusChange={setStatus} />
    </div>
  );
}
