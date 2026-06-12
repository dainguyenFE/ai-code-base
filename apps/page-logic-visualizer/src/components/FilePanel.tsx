"use client";

import type { PageLogicGraph } from "@cs/page-logic-visualizer/client";

interface FilePanelProps {
  graph: PageLogicGraph;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

export function FilePanel({
  graph,
  selectedFile,
  onSelectFile,
}: FilePanelProps) {
  if (graph.files.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No related files tracked yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">Related files</h3>
      <ul className="max-h-48 space-y-1 overflow-auto text-xs">
        {graph.files.map((file) => (
          <li key={file.filePath}>
            <button
              className={
                selectedFile === file.filePath
                  ? "w-full rounded bg-accent px-2 py-1 text-left hover:bg-accent"
                  : "w-full rounded px-2 py-1 text-left hover:bg-accent"
              }
              onClick={() => onSelectFile(file.filePath)}
              type="button"
            >
              <code className="break-all">{file.filePath}</code>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
