import { Link } from 'react-router-dom';

const CODE_SNIPPET = `import { createWorkflow } from 'flowyd';
import { z } from 'zod';

const workflow = createWorkflow({ name: 'purchase-approval' })
  .defineAction('SUBMIT',  z.object({ amount: z.number(), vendor: z.string() }))
  .defineAction('APPROVE', z.object({ approvedBy: z.string() }))
  .defineAction('REJECT',  z.object({ reason: z.string() }))
  .addStep('draft')
  .addStep('review')
  .addStep('approved')
  .addStep('rejected')
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft',   to: 'review',   on: 'SUBMIT' })
  .addTransition({ from: 'review',  to: 'approved', on: 'APPROVE',
    guard: (ctx) => ctx.payload.approvedBy.trim() !== '' })
  .addTransition({ from: 'review',  to: 'rejected', on: 'REJECT' })
  .build();`;

const FEATURES = [
  {
    icon: '⬡',
    title: 'Compile-time type safety',
    desc: 'State IDs, action names, and payload shapes are all checked at build time. Typos in addTransition are compile errors.',
  },
  {
    icon: '⑂',
    title: 'Fork / Join parallelism',
    desc: 'Split into parallel branches with ForkState and synchronise them with JoinState. All/any/quorum modes supported.',
  },
  {
    icon: '⊕',
    title: 'Composable guards',
    desc: 'Inline guards, injected guards, and combinators (and, or, not). Async-first — every guard returns Promise<boolean>.',
  },
  {
    icon: '◑',
    title: 'Pure stateless engine',
    desc: 'WorkflowEngine.dispatch() is a static function. No I/O. Snapshots are plain JSON — persist anywhere.',
  },
];

const EXAMPLES = [
  {
    id: 'purchase-order',
    label: 'Purchase Order',
    tags: ['linear', 'branching', 'guard'],
    desc: 'Linear approval chain with guard-protected APPROVE and reject terminal split.',
    color: 'border-blue-200 bg-blue-50',
    tagColor: 'bg-blue-100 text-blue-700',
  },
  {
    id: 'predeparture',
    label: 'Pre-Departure Checklist',
    tags: ['fork', 'join', 'parallel'],
    desc: '3 parallel inspection branches that must all complete before the engineer may depart.',
    color: 'border-violet-200 bg-violet-50',
    tagColor: 'bg-violet-100 text-violet-700',
  },
  {
    id: 'incident',
    label: 'IT Incident Response',
    tags: ['inline guard', 'inject guard'],
    desc: 'Inline payload guards + a named injected guard for management sign-off.',
    color: 'border-green-200 bg-green-50',
    tagColor: 'bg-green-100 text-green-700',
  },
  {
    id: 'ewcr',
    label: 'EWCR Grid',
    tags: ['multi-instance', 'cross-guard'],
    desc: '40 electrical sections — each waits for its neighbours before isolating or restoring.',
    color: 'border-amber-200 bg-amber-50',
    tagColor: 'bg-amber-100 text-amber-700',
  },
] as const;

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-100 flex items-center px-6 h-12 gap-6">
        <span className="font-bold text-slate-900 text-base tracking-tight">flowyd</span>
        <div className="flex items-center gap-5 ml-auto">
          <Link to="/examples/purchase-order" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">
            Examples
          </Link>
          <Link
            to="/designer"
            className="text-sm bg-slate-900 text-white rounded-md px-3 py-1.5 hover:bg-slate-700 transition-colors"
          >
            Open Designer
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-slate-900 text-white pt-20 pb-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold leading-tight mb-4 tracking-tight">
              Typed Workflow State<br />Machines for TypeScript
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed mb-8">
              Build, execute, and visualise auditable multi-step workflows with
              full compile-time type safety. Pure functional engine, serialisable
              snapshots, composable guards.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link
                to="/examples/purchase-order"
                className="bg-white text-slate-900 font-medium text-sm rounded-md px-5 py-2.5 hover:bg-slate-100 transition-colors"
              >
                View Examples
              </Link>
              <Link
                to="/designer"
                className="bg-blue-600 text-white font-medium text-sm rounded-md px-5 py-2.5 hover:bg-blue-500 transition-colors"
              >
                Open Designer →
              </Link>
            </div>
          </div>

          {/* Code snippet */}
          <div className="mt-12 rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
            <div className="flex items-center px-4 h-9 bg-slate-800 border-b border-slate-700 gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-70" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 opacity-70" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-70" />
              <span className="ml-2 text-[11px] text-slate-500 font-mono">workflow.ts</span>
            </div>
            <pre className="text-[12.5px] leading-relaxed text-slate-300 font-mono px-5 py-4 overflow-x-auto">
              <code>{CODE_SNIPPET}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-6 bg-slate-50 border-b border-slate-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-bold text-slate-800 mb-8">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white border border-slate-200 rounded-xl p-5">
                <span className="text-2xl block mb-3">{f.icon}</span>
                <h3 className="font-semibold text-slate-800 text-sm mb-1.5">{f.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Examples */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline justify-between mb-8">
            <h2 className="text-xl font-bold text-slate-800">Examples</h2>
            <Link to="/examples/purchase-order" className="text-sm text-blue-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {EXAMPLES.map(ex => (
              <Link
                key={ex.id}
                to={`/examples/${ex.id}`}
                className={`block border-2 rounded-xl p-5 hover:shadow-md transition-shadow ${ex.color}`}
              >
                <h3 className="font-semibold text-slate-800 text-base mb-1">{ex.label}</h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-3">{ex.desc}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ex.tags.map(t => (
                    <span key={t} className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${ex.tagColor}`}>
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Designer CTA */}
      <section className="py-16 px-6 bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-6 justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Visual Workflow Designer</h2>
            <p className="text-slate-400 text-sm max-w-md">
              Drag and connect states, edit the TypeScript code — the canvas and code stay in sync.
              Full IntelliSense powered by Monaco Editor.
            </p>
          </div>
          <Link
            to="/designer"
            className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg px-6 py-3 transition-colors"
          >
            Open Designer →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 px-6 border-t border-slate-100 text-center text-xs text-slate-400">
        flowyd — MIT licence
      </footer>
    </div>
  );
}
