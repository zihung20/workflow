import React, { useEffect, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { setupMonacoTypes, updateGuardContextTypes } from './monacoSetup';

interface Props {
  edgeId: string;
  nodeIds: string[];
  payloadZodBody?: string;
  contextZodBody?: string;
  value: string;
  onChange(body: string): void;
}

export function GuardEditor({ edgeId, nodeIds, payloadZodBody = '', contextZodBody = '', value, onChange }: Props) {
  const monacoInstance = useMonaco();
  const argsRef = useRef({ nodeIds, payloadZodBody, contextZodBody });
  argsRef.current = { nodeIds, payloadZodBody, contextZodBody };

  // Keep ctx type in sync whenever IDs or schema bodies change.
  useEffect(() => {
    if (monacoInstance) {
      updateGuardContextTypes(monacoInstance, nodeIds, payloadZodBody, contextZodBody);
    }
  }, [monacoInstance, nodeIds, payloadZodBody, contextZodBody]);

  function handleBeforeMount(monaco: Monaco) {
    setupMonacoTypes(monaco);
    const { nodeIds: ids, payloadZodBody: p, contextZodBody: c } = argsRef.current;
    updateGuardContextTypes(monaco, ids, p, c);
  }

  const codeFontStyle: React.CSSProperties = {
    fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
    fontSize: 12,
  };

  return (
    <div className="rounded border border-border overflow-hidden" onKeyDown={e => e.stopPropagation()}>
      <div style={codeFontStyle} className="px-3 py-1 bg-[#1e1e1e] text-zinc-500 border-b border-border select-none">
        {'async (ctx) => {'}
      </div>
      <Editor
        path={`file:///guard-${edgeId}.ts`}
        height="150px"
        language="typescript"
        value={value}
        theme="vs-dark"
        onChange={v => onChange(v ?? '')}
        beforeMount={handleBeforeMount}
        options={{
          fontSize: 12,
          fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
          lineNumbers: 'off',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          padding: { top: 8, bottom: 8 },
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          parameterHints: { enabled: true },
          automaticLayout: true,
          scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          folding: false,
          glyphMargin: false,
          fixedOverflowWidgets: true,
        }}
      />
      <div style={codeFontStyle} className="px-3 py-1 bg-[#1e1e1e] text-zinc-500 border-t border-border select-none">
        {'}'}
      </div>
    </div>
  );
}
