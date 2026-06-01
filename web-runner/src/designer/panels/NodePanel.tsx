import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import type { DesignerNode, NodeKind } from '../types';

interface Props {
  node: DesignerNode;
  onChange: (updated: DesignerNode) => void;
  onDelete: () => void;
}

const KIND_OPTIONS: { value: NodeKind; label: string; description: string }[] = [
  { value: 'step', label: 'Step',   description: 'Waits for an action to be dispatched' },
  { value: 'fork', label: 'Fork',   description: 'Activates parallel branches simultaneously' },
  { value: 'join', label: 'Join',   description: 'Synchronises parallel branches' },
  { value: 'wait', label: 'Wait',   description: 'Pauses until an external signal resolves it' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function NodePanel({ node, onChange, onDelete }: Props) {
  function set<K extends keyof DesignerNode>(k: K, v: DesignerNode[K]) {
    onChange({ ...node, [k]: v });
  }

  return (
    <div className="p-3 space-y-3">

      <Field label="State ID">
        <Input
          value={node.id}
          onChange={e => set('id', e.target.value)}
          placeholder="state-id"
        />
      </Field>

      <Field label="Label">
        <Input
          value={node.label}
          onChange={e => set('label', e.target.value)}
          placeholder="Display label"
        />
      </Field>

      <Field label="Kind">
        <Select value={node.kind} onValueChange={v => set('kind', v as NodeKind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>
                <span className="font-medium">{o.label}</span>
                <span className="ml-1.5 text-muted-foreground">{o.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Flags">
        <div className="flex flex-wrap gap-4 pt-0.5">
          {([['isInitial', '▶ Initial'], ['isTerminal', '■ Terminal']] as const).map(([key, lbl]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none text-xs text-foreground">
              <Checkbox
                checked={node[key] as boolean}
                onCheckedChange={v => set(key, !!v)}
              />
              {lbl}
            </label>
          ))}
        </div>
      </Field>

      {node.kind === 'join' && (
        <>
          <Field label="Synchronisation mode">
            <Select
              value={typeof node.joinMode === 'number' ? 'quorum' : node.joinMode}
              onValueChange={v => set('joinMode', v === 'quorum' ? 2 : (v as 'all' | 'any'))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all — every required state must complete</SelectItem>
                <SelectItem value="any">any — at least one must complete</SelectItem>
                <SelectItem value="quorum">quorum — N states must complete</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {typeof node.joinMode === 'number' && (
            <Field label="Quorum count">
              <Input
                type="number"
                min={1}
                value={node.joinMode}
                onChange={e => set('joinMode', Math.max(1, parseInt(e.target.value) || 1))}
              />
            </Field>
          )}
        </>
      )}

      {node.kind === 'wait' && (
        <Field label="External name">
          <Input
            value={node.waitExternalName}
            onChange={e => set('waitExternalName', e.target.value)}
            placeholder="external-service-name"
          />
        </Field>
      )}

      <Button variant="destructive" size="sm" className="w-full mt-1" onClick={onDelete}>
        Delete state
      </Button>
    </div>
  );
}
