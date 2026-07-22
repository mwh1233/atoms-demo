"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CodePreview, type PreviewStatus } from "@/components/preview/CodePreview";
import { EditorView } from "@/components/preview/EditorView";
import { PreviewTabs, type PreviewTab } from "@/components/preview/PreviewTabs";
import type { PreviewDevice } from "@/components/preview/DeviceFrame";

type ProjectPreviewDemoProps = {
  code: string;
  deployUrl?: string | null;
  generatedFiles?: Record<string, string>;
  templateId?: string | null;
};

function getPreviewCode(
  fallbackCode: string,
  files: Record<string, string>
) {
  return files["index.html"] || files["frontend/index.html"] || fallbackCode;
}

export function ProjectPreviewDemo({
  code,
  deployUrl,
  generatedFiles = {},
  templateId = "fullstack-shadcn"
}: ProjectPreviewDemoProps) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [activeTab, setActiveTab] = useState<PreviewTab>("preview");
  const [localFiles, setLocalFiles] = useState<Record<string, string>>(generatedFiles);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileName = useMemo(() => `atoms-preview-${Date.now()}.html`, []);
  const previewCode = useMemo(
    () => getPreviewCode(code, localFiles),
    [code, localFiles]
  );

  useEffect(() => {
    setLocalFiles(generatedFiles);
    setActiveFile((current) => {
      if (current && generatedFiles[current]) {
        return current;
      }
      return Object.keys(generatedFiles).sort()[0] || null;
    });
  }, [generatedFiles]);

  function handleDownload() {
    const blob = new Blob([previewCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenNewTab() {
    const blob = new Blob([previewCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function handleFullscreen() {
    void containerRef.current?.requestFullscreen();
  }

  function handleCodeChange(path: string, nextCode: string) {
    setLocalFiles((current) => ({
      ...current,
      [path]: nextCode
    }));
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
    >
      <PreviewTabs
        activeTab={activeTab}
        device={device}
        status={status}
        onDeviceChange={setDevice}
        onDownload={handleDownload}
        onFullscreen={handleFullscreen}
        onOpenNewTab={handleOpenNewTab}
        onRefresh={() => setRefreshKey((key) => key + 1)}
        onTabChange={setActiveTab}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "preview" ? (
          <CodePreview
            code={previewCode}
            deployUrl={deployUrl}
            device={device}
            refreshKey={refreshKey}
            onStatusChange={setStatus}
          />
        ) : (
          <EditorView
            activeFile={activeFile}
            files={localFiles}
            onCodeChange={handleCodeChange}
            onFileSelect={setActiveFile}
          />
        )}
      </div>
    </div>
  );
}
