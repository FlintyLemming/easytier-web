# Rulings made during execution of Plan 3 (overview dashboard)

Collected from the SDD ledger (controller decisions taken on the user's behalf). Each line: decision — reason — cost if wrong.

- Ruling R1: if places.json gzip > 150KB, drop NAME_ZHT from cities, then raise non-CN city threshold to POP_MAX ≥ 150000 — spec budget is binding, plan silent on overflow — cost if wrong: fewer small foreign cities match (fall back to region/country).
- Ruling R2: in place on branch feat/overview, no worktree — same reasoning as Plans 1–2 (Docker bind mounts, live smoke) — cost: none.
- Ruling R3: T6 appShell.test.ts may stub AppShell's child components — plan silent — cost: none.
- Ruling: refreshFleet single-flight test asserts "second call during flight issues no new fetches and settles with the first" instead of "returns the same promise" — Pinia wraps action promises (new promise per call), so identity is unobservable through the store; the brief's intent (no duplicate RPCs) is what the spec (§6.1 同一时刻每类请求只能有一个) requires — cost if wrong: none.
- Ruling: RouteMeta augmentation lives in new src/route-meta.d.ts instead of env.d.ts — `declare module` in the script-style env.d.ts replaced vue-router's types; a module-style .d.ts is the standard fix — cost if wrong: none.
- Ruling: tests/e2e/shell.spec.ts edited (it asserted no 概览 link) — direct consequence of the plan's nav change — cost: none.
- Ruling: live smoke edits verified in Task 9 (needs Docker env) — cost: one rerun.
- Ruling: map legend sits in a fixed row directly under the map's bottom-left corner instead of overlaid inside it — overlay covered the 香港 cluster at the focus box's bottom edge; spec §5.5 doesn't fix legend placement — cost if wrong: CSS move.
- Ruling: fix wave scope = Important #1 + Minors #2,#3,#4,#5,#6,#7 — all cheap except #5; #5 included because with ~42 devices a fleet pass queues ~84 RPCs behind the 4-slot limiter, delaying the detail page by seconds after navigating from the overview — cost if wrong: one more moderately sized change in the runtime store.
- Ruling: click filter uses the distinct locationText of every device in the cluster/group; a region-level group whose label equals a city-level group's label in the same country folds into the city group — keeps "click a dot → see exactly those devices" (spec §5.5) once GeoLite2 is on — cost if wrong: chip may read 「浙江 等 2 地」 for one dot.
