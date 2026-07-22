"use client";

import { useEffect, useMemo, useState } from "react";
import { FileTree } from "@/components/preview/FileTree";
import { CodeEditor } from "@/components/preview/CodeEditor";

type EditorViewProps = {
  files: Record<string, string>;
  activeFile?: string | null;
  onFileSelect?: (path: string) => void;
  onCodeChange: (path: string, code: string) => void;
};

function getLanguage(path: string | null) {
  if (!path) return "text";
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".json")) return "json";
  return "text";
}

export function EditorView({
  files,
  activeFile: controlledActiveFile = null,
  onFileSelect,
  onCodeChange
}: EditorViewProps) {
  const filePaths = useMemo(() => Object.keys(files).sort(), [files]);
  const [internalActiveFile, setInternalActiveFile] = useState<string | null>(
    controlledActiveFile || filePaths[0] || null
  );
  const activeFile = controlledActiveFile ?? internalActiveFile;

  useEffect(() => {
    if (!filePaths.length) {
      setInternalActiveFile(null);
      return;
    }

    if (!activeFile || !files[activeFile]) {
      const nextFile = filePaths[0];
      setInternalActiveFile(nextFile);
      onFileSelect?.(nextFile);
    }
  }, [activeFile, filePaths, files, onFileSelect]);

  function handleFileSelect(path: string) {
    setInternalActiveFile(path);
    onFileSelect?.(path);
  }

  if (!filePaths.length) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b1120] px-6 text-center">
        <div>
          <p className="text-sm font-medium text-slate-100">暂无可编辑文件</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
            当前项目还没有生成多文件代码树。旧项目或单文件 HTML 项目可以继续使用效果预览。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#0b1120]">
      <FileTree
        activeFile={activeFile}
        files={files}
        onFileSelect={handleFileSelect}
      />
      <div className="w-px bg-slate-800" />
      <CodeEditor
        code={activeFile ? files[activeFile] || "" : ""}
        language={getLanguage(activeFile)}
        onChange={(code) => {
          if (activeFile) {
            onCodeChange(activeFile, code);
          }
        }}
      />
    </div>
  );
}
