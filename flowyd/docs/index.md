---
layout: home

hero:
  name: flowyd
  text: Strongly-typed SOP state machines
  tagline: Build, execute, and visualize workflow state machines in TypeScript — with compile-time safety on every state ID, action name, and payload shape.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: See Examples
      link: /examples/
    - theme: alt
      text: API Reference
      link: /api/

features:
  - icon: 🔒
    title: Compile-time type safety
    details: Every state ID, action name, and payload field is checked by TypeScript. Typos and wrong shapes are caught before your code runs.

  - icon: ✅
    title: Zod-validated at runtime
    details: Each action payload is validated against its Zod schema before any transition fires. The same schema drives both the TypeScript type and the runtime check — no duplication.

  - icon: 🔀
    title: Parallel branches
    details: ForkState fans out to concurrent steps; JoinState synchronises them with "all", "any", or a quorum threshold — resolved in a single engine tick.

  - icon: ⏸️
    title: External wait states
    details: WaitState pauses the workflow until your service layer signals completion. The engine has no I/O, no polling, no callbacks.

  - icon: 💾
    title: Purely functional persistence
    details: getSnapshot() produces plain JSON. restoreInstance(snapshot) reconstructs exact state. You own the database — the library owns nothing.

  - icon: 📊
    title: Built-in visualization
    details: Export to Mermaid stateDiagram-v2 or a JSON graph for React Flow, D3, or Cytoscape — with live status overlays.
---
