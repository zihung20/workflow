import { useState } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { SingleRunner } from '../runners/SingleRunner';
import { EwcrRunner } from '../runners/EwcrRunner';
import { purchaseOrderWorkflow } from '../workflows/purchase-order';
import { predepartureWorkflow } from '../workflows/predeparture';
import { incidentWorkflow } from '../workflows/incident';

const EXAMPLES = [
  {
    id: 'purchase-order',
    label: 'Purchase Order',
    tags: ['linear', 'branching'],
    desc: 'Linear approval with approve / reject terminal split',
  },
  {
    id: 'predeparture',
    label: 'Pre-Departure',
    tags: ['fork', 'join', 'parallel'],
    desc: '3 parallel inspection branches that must all complete before sign-off',
  },
  {
    id: 'incident',
    label: 'IT Incident',
    tags: ['inline guard', 'inject guard'],
    desc: 'Inline payload guards + a named injected guard for management sign-off',
  },
  {
    id: 'ewcr',
    label: 'EWCR Grid',
    tags: ['multi-instance', 'cross-guard'],
    desc: '40 electrical sections — each waits for its neighbours before isolating or restoring',
  },
] as const;

type ExampleId = (typeof EXAMPLES)[number]['id'];

function makePoInstance() {
  return purchaseOrderWorkflow.createInstance(`po-${Date.now()}`);
}

function makePdInstance() {
  return predepartureWorkflow.createInstance(`pd-${Date.now()}`);
}

function makeIncidentInstance() {
  const inst = incidentWorkflow.createInstance(`inc-${Date.now()}`);
  inst.injectGuard('management-sign-off', () => true);
  return inst;
}

const VALID_IDS = new Set<string>(EXAMPLES.map(e => e.id));

export default function ExamplesPage() {
  const { id } = useParams<{ id: string }>();

  const exId = (id && VALID_IDS.has(id) ? id : 'purchase-order') as ExampleId;

  if (id && !VALID_IDS.has(id)) {
    return <Navigate to="/examples/purchase-order" replace />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 font-sans">
      <nav className="shrink-0 bg-slate-900 border-b border-slate-700 flex items-stretch gap-0 px-2">
        <Link
          to="/"
          className="flex items-center px-3 text-slate-400 hover:text-white text-sm transition-colors border-b-2 border-transparent"
        >
          ← flowyd
        </Link>
        <span className="flex items-center text-slate-600 text-sm px-1">/</span>

        {EXAMPLES.map(ex => (
          <Link
            key={ex.id}
            to={`/examples/${ex.id}`}
            className={[
              'flex flex-col items-start px-4 py-2.5 text-left transition-colors border-b-2',
              exId === ex.id
                ? 'border-blue-400 bg-slate-800 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800',
            ].join(' ')}
          >
            <span className="text-sm font-semibold leading-tight">{ex.label}</span>
            <span className="flex gap-1 mt-0.5">
              {ex.tags.map(t => (
                <span key={t} className="text-[10px] bg-slate-700 text-slate-300 rounded px-1 py-px leading-none">
                  {t}
                </span>
              ))}
            </span>
          </Link>
        ))}

        <div className="ml-auto flex items-center px-4">
          <span className="text-xs text-slate-500 max-w-xs hidden lg:block">
            {EXAMPLES.find(e => e.id === exId)?.desc}
          </span>
        </div>
      </nav>

      <div className="flex-1 min-h-0">
        {exId === 'purchase-order' && (
          <SingleRunner
            key="po"
            title="Purchase Order Approval"
            subtitle="Linear workflow with approve / reject branching"
            definition={purchaseOrderWorkflow.getDefinition()}
            makeInstance={makePoInstance}
          />
        )}
        {exId === 'predeparture' && (
          <SingleRunner
            key="pd"
            title="Engineer Pre-Departure Checklist"
            subtitle="Fork → 3 parallel inspections → Join → sign-off"
            definition={predepartureWorkflow.getDefinition()}
            makeInstance={makePdInstance}
          />
        )}
        {exId === 'incident' && (
          <SingleRunner
            key="inc"
            title="IT Incident Response"
            subtitle="Inline payload guards + injected management sign-off guard"
            definition={incidentWorkflow.getDefinition()}
            makeInstance={makeIncidentInstance}
          />
        )}
        {exId === 'ewcr' && <EwcrRunner key="ewcr" />}
      </div>
    </div>
  );
}
