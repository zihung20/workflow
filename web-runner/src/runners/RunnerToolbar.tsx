import { useState } from 'react';
import type { InstanceSnapshot, WorkflowDefinition } from 'flowyd';
import { MermaidExporter, JsonGraphExporter } from 'flowyd/visualization';
import { Button } from '../components/ui/button';

// Deflate-compresses a Mermaid diagram string and opens it in mermaid.live using
// the pako URL scheme it expects (base64-encoded deflate-raw).
async function openInMermaidLive(diagram: string): Promise<void> {
  const json = JSON.stringify({ code: diagram, mermaid: { theme: 'default' } });
  const data = new TextEncoder().encode(json);
  const cs   = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (value) chunks.push(value);
    if (done) break;
  }
  const len        = chunks.reduce((s, c) => s + c.length, 0);
  const compressed = new Uint8Array(len);
  let offset = 0;
  for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length; }
  const b64 = btoa(String.fromCharCode(...compressed));
  window.open(`https://mermaid.live/edit#pako:${b64}`, '_blank');
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface Props {
  title:      string;
  subtitle:   string;
  definition: WorkflowDefinition;
  snapshot:   InstanceSnapshot;
  onReset:    () => void;
}

/** Sticky header bar for SingleRunner — shows workflow title and export actions. */
export function RunnerToolbar({ title, subtitle, definition, snapshot, onReset }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="shrink-0 px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-3">
      <span className="text-sm font-bold text-slate-800">{title}</span>
      <span className="text-xs text-slate-400">{subtitle}</span>
      <span className="ml-auto text-xs text-slate-400">
        v{snapshot.version} · {snapshot.isTerminal ? 'complete' : 'in progress'}
      </span>
      <div className="flex items-center gap-1 ml-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => {
            const diagram = MermaidExporter.export(definition, snapshot);
            void navigator.clipboard.writeText(diagram).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied!' : 'Copy Mermaid'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => downloadBlob(
            `${definition.name}.mmd`,
            MermaidExporter.export(definition, snapshot),
            'text/plain',
          )}
        >
          Download .mmd
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => downloadBlob(
            `${definition.name}.json`,
            JSON.stringify(JsonGraphExporter.export(definition, snapshot), null, 2),
            'application/json',
          )}
        >
          Download JSON
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-600"
          onClick={() => void openInMermaidLive(MermaidExporter.export(definition, snapshot))}
        >
          Mermaid Live ↗
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-600"
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
