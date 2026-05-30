import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { setupMonacoTypes } from './monacoSetup';

export interface CodeEditorHandle {
  setValue(code: string): void;
  getValue(): string;
}

interface Props {
  defaultValue: string;
  onChange?: (value: string) => void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(({ defaultValue, onChange }, ref) => {
  const editorRef     = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoInstance = useMonaco();

  // Belt-and-suspenders: register types whenever Monaco becomes available.
  // beforeMount already does this, but useMonaco fires even if the Editor
  // component hasn't mounted yet (Monaco CDN loaded by a sibling).
  useEffect(() => {
    if (monacoInstance) setupMonacoTypes(monacoInstance);
  }, [monacoInstance]);

  useImperativeHandle(ref, () => ({
    setValue(code) {
      const e = editorRef.current;
      if (!e) return;
      const model = e.getModel();
      if (!model) return;
      // pushEditOperations preserves undo history and fires onDidChangeContent
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
    },
    getValue() {
      return editorRef.current?.getValue() ?? '';
    },
  }));

  function handleBeforeMount(monaco: Monaco) {
    setupMonacoTypes(monaco);
  }

  function handleMount(e: editor.IStandaloneCodeEditor) {
    editorRef.current = e;
  }

  return (
    <Editor
      // file:/// URI is required so TypeScript's module resolver can find the
      // extra libs registered at file:///node_modules/{flowyd,zod}/index.d.ts.
      // With an inmemory:// URI (Monaco's default), cross-scheme resolution fails.
      path="file:///workflow.ts"
      height="100%"
      language="typescript"
      defaultValue={defaultValue}
      theme="vs-dark"
      onChange={value => onChange?.(value ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        fontSize: 13,
        fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderLineHighlight: 'gutter',
        wordWrap: 'on',
        tabSize: 2,
        padding: { top: 16, bottom: 16 },
        readOnly: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        parameterHints: { enabled: true },
        automaticLayout: true,
      }}
    />
  );
});

CodeEditor.displayName = 'CodeEditor';
