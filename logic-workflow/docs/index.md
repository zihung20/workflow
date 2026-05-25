---
layout: home

hero:
  name: logic-workflow
  text: Strongly-typed SOP state machines
  tagline: Model, execute, and visualize Standard Operating Procedures in TypeScript — with kernel-level reliability.
  actions:
    - theme: brand
      text: Get Started
      link: /tutorials/first-workflow
    - theme: alt
      text: API Reference
      link: /reference/

features:
  - icon: 🔒
    title: Fully type-safe
    details: Every action name and payload is typed end-to-end. Typos in action names and schema mismatches are caught at compile time.

  - icon: ✅
    title: Zod-validated at every boundary
    details: Each action payload is validated against its Zod schema before any state transition fires. Runtime surprises are impossible.

  - icon: 🔀
    title: Parallel branches
    details: ForkState fans out to concurrent steps; JoinState synchronises them with "all", "any", or a quorum threshold — resolved in a single engine tick.

  - icon: ⏸️
    title: External wait states
    details: WaitState pauses the parent workflow until your service layer signals completion. The engine has no I/O coupling whatsoever.

  - icon: 💾
    title: Purely functional persistence
    details: getSnapshot() produces plain JSON. restoreInstance(snapshot) reconstructs exact state. You own the database — we own nothing.

  - icon: 📊
    title: Built-in visualization
    details: Export to Mermaid stateDiagram-v2 or a JSON graph object for D3, React Flow, or Cytoscape — with live status overlays.
---
