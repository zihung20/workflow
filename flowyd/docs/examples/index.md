# Examples

Each example is a complete, runnable TypeScript file demonstrating a different combination of workflow features. All code is copy-pasteable.

| Example                                                   | Key features                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Purchase Order Approval](./approval-flow)                | Linear flow, typed Zod payloads, named guards, `getSnapshot` / `restoreInstance`     |
| [Engineer Pre-Departure Checklist](./parallel-inspection) | `ForkState`, `JoinState mode:'all'`, inline guard with Zod literal                   |
| [OCC Service Disruption SOP](./disruption-sop)            | Multi-role named guards, fork + join + wait state combined, `JsonGraphExporter`      |
| [Station Opening Checklist](./station-opening)            | Sequential flow, `canExecute` for UI affordances, snapshot hand-off / crash recovery |

## How to run an example locally

```sh
cd flowyd
pnpm build
npx tsx examples/<filename>.ts
```
