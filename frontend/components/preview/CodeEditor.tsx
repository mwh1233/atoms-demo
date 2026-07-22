"use client";

type CodeEditorProps = {
  code: string;
  language?: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
};

export function CodeEditor({
  code,
  language,
  onChange,
  readOnly = false
}: CodeEditorProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#0b1120]">
      <div className="flex h-9 items-center border-b border-slate-800 px-4 font-mono text-xs text-slate-400">
        {language || "text"}
      </div>
      <textarea
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-600"
        readOnly={readOnly}
        spellCheck={false}
        value={code}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
