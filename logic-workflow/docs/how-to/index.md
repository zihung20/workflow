# How-To Guides

How-to guides are **task-oriented**. Each guide answers a specific question: "How do I…?" They assume you already understand the basics — if you are new to `logic-workflow`, start with the [Tutorial](/tutorials/first-workflow) first.


## Available guides

### [Run steps in parallel](./parallel-branches)

Use `ForkState` to split execution into concurrent branches and `JoinState` to synchronise them back. Covers `mode: 'all'`, `'any'`, and quorum thresholds.

### [Pause for an external process](./wait-state)

Use `WaitState` to block a parent workflow until an external process signals completion. Covers `resolveWait` and the service-layer pattern.

### [Control transitions with guards](./guards)

Compose guards from `Guard.inject`, `Guard.fn`, `Guard.stateCompleted`, `Guard.and`, `Guard.or`, and `Guard.not` to model complex authorization rules.

### [Save and restore state](./persistence)

Persist `InstanceSnapshot` objects and recover from crashes or hand-offs. Covers optimistic concurrency with `snapshot.version`.
