"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

type FileTreeProps = {
  files: Record<string, string>;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
};

type TreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  children: Map<string, TreeNode>;
};

function createNode(name: string, path: string, type: TreeNode["type"]): TreeNode {
  return {
    name,
    path,
    type,
    children: new Map()
  };
}

function buildTree(files: Record<string, string>) {
  const root = createNode("", "", "folder");

  Object.keys(files)
    .sort((a, b) => a.localeCompare(b))
    .forEach((filePath) => {
      const parts = filePath.split("/").filter(Boolean);
      let current = root;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        const path = parts.slice(0, index + 1).join("/");
        const existing = current.children.get(part);

        if (existing) {
          current = existing;
          return;
        }

        const node = createNode(part, path, isFile ? "file" : "folder");
        current.children.set(part, node);
        current = node;
      });
    });

  return root;
}

export function FileTree({ files, activeFile, onFileSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function renderNode(node: TreeNode, depth: number) {
    const isFolder = node.type === "folder";
    const isCollapsed = collapsedFolders.has(node.path);
    const children = Array.from(node.children.values()).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    if (isFolder) {
      return (
        <div key={node.path || "root"}>
          {node.path ? (
            <button
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[13px] text-slate-300 transition-colors duration-150 hover:bg-slate-800"
              style={{ paddingLeft: 8 + depth * 12 }}
              type="button"
              onClick={() => toggleFolder(node.path)}
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-slate-500 transition-transform duration-150",
                  !isCollapsed && "rotate-90"
                )}
              />
              {isCollapsed ? (
                <Folder className="h-4 w-4 text-sky-400" />
              ) : (
                <FolderOpen className="h-4 w-4 text-sky-400" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          ) : null}
          {!isCollapsed
            ? children.map((child) => renderNode(child, node.path ? depth + 1 : depth))
            : null}
        </div>
      );
    }

    return (
      <button
        key={node.path}
        className={cn(
          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[13px] transition-colors duration-150",
          activeFile === node.path
            ? "bg-sky-500/18 text-sky-100 ring-1 ring-sky-500/30"
            : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
        )}
        style={{ paddingLeft: 26 + depth * 12 }}
        type="button"
        onClick={() => onFileSelect(node.path)}
      >
        <FileCode2 className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <aside className="h-full w-[220px] shrink-0 overflow-auto bg-slate-950/70 p-2">
      {Array.from(tree.children.values()).map((node) => renderNode(node, 0))}
    </aside>
  );
}
