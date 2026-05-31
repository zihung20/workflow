import Editor, { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { setupMonacoTypes } from './monacoSetup';

export const EMPTY_SCHEMA = 'z.object({})';

interface Props {
  /** Unique ID for the Monaco model — use action name or 'context'. */
  id: string;
  value: string;
  onChange(value: string): void;
}

export function SchemaEditor({ id, value, onChange }: Props) {
  const monacoInstance = useMonaco();

  useEffect(() => {
    if (monacoInstance) setupMonacoTypes(monacoInstance);
  }, [monacoInstance]);

  function handleBeforeMount(monaco: Monaco) {
    setupMonacoTypes(monaco);
  }

  return (
    <div className="rounded border border-border overflow-hidden" onKeyDown={e => e.stopPropagation()}>
      <Editor
        path={`file:///schema-${id}.ts`}
        height="80px"
        language="typescript"
        value={value || EMPTY_SCHEMA}
        theme="vs-dark"
        onChange={v => onChange(v ?? EMPTY_SCHEMA)}
        beforeMount={handleBeforeMount}
        options={{
          fontSize: 12,
          fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
          lineNumbers: 'off',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          padding: { top: 6, bottom: 6 },
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
    </div>
  );
}
