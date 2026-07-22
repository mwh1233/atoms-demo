"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeviceFrame, type PreviewDevice } from "@/components/preview/DeviceFrame";

export type PreviewStatus = "loading" | "success" | "error";

type CodePreviewProps = {
  code: string;
  device: PreviewDevice;
  deployUrl?: string | null;
  refreshKey?: number;
  onStatusChange?: (status: PreviewStatus) => void;
};

export function CodePreview({
  code,
  device,
  deployUrl,
  refreshKey = 0,
  onStatusChange
}: CodePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const previousUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (deployUrl) {
      setStatus("loading");
      onStatusChange?.("loading");
      setPreviewUrl(`${deployUrl}${deployUrl.includes("?") ? "&" : "?"}r=${Date.now()}`);

      if (previousUrlRef.current) {
        URL.revokeObjectURL(previousUrlRef.current);
        previousUrlRef.current = null;
      }
      return;
    }

    if (!code.trim()) {
      setStatus("error");
      onStatusChange?.("error");
      setPreviewUrl("");
      return;
    }

    setStatus("loading");
    onStatusChange?.("loading");

    const blob = new Blob([code], { type: "text/html" });
    const nextUrl = URL.createObjectURL(blob);
    setPreviewUrl(nextUrl);

    if (previousUrlRef.current) {
      URL.revokeObjectURL(previousUrlRef.current);
    }
    previousUrlRef.current = nextUrl;

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [code, deployUrl, reloadKey, refreshKey, onStatusChange]);

  function handleLoad() {
    setStatus("success");
    onStatusChange?.("success");
  }

  function handleError() {
    setStatus("error");
    onStatusChange?.("error");
  }

  return (
    <DeviceFrame device={device}>
      <div className="relative h-full min-h-0 bg-[#0f172a]">
        {status === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0f172a] text-slate-200">
            <div className="flex flex-col items-center gap-4 px-6 text-center">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 ring-1 ring-white/10">
                <div className="absolute inset-0 rounded-full bg-sky-400/20 blur-md" />
                <Loader2 className="relative h-5 w-5 animate-spin text-sky-300" />
              </div>
              <div>
                <p className="font-medium text-white">正在准备预览</p>
                <p className="mt-1 text-sm text-slate-400">代码生成后会自动刷新到这里。</p>
              </div>
            </div>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0f172a] px-6 text-center text-slate-200">
            <TriangleAlert className="mb-3 h-8 w-8 text-red-400" />
            <p className="font-medium text-white">预览加载失败</p>
            <p className="mt-2 text-sm text-slate-400">请检查生成的 HTML 代码后重试。</p>
            <Button className="mt-4" type="button" onClick={() => setReloadKey((key) => key + 1)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重试
            </Button>
          </div>
        ) : null}
        {previewUrl ? (
          <iframe
            key={previewUrl}
            className="h-full w-full bg-[#0f172a]"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            src={previewUrl}
            title="代码预览"
            onError={handleError}
            onLoad={handleLoad}
          />
        ) : null}
      </div>
    </DeviceFrame>
  );
}
