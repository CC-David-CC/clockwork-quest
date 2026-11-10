> Original design reference from 2026-10-30. This describes intended behavior, not current implementation or qualification. The current app README is authoritative for status. Pseudocode and template JSON here are documentation, not build entries.

# Acceptance — Clockwork Quest

**All runtime cases are NOT RUN.** This file is a plan; document checks are not gameplay evidence.

Apply all C01–C24 in [common acceptance](../../../../../docs/games/design-reference/ACCEPTANCE-COMMON.md). Also apply X01–X16 on the actual Galaxy XR.

## Game-specific cases

| ID | Experiment / invariant | Status |
|---|---|---|
| clockwork-quest-G01 | Unreachable destination gets feedback without endless path retries. | not_run |
| clockwork-quest-G02 | Interaction cannot activate through a closed wall. | not_run |
| clockwork-quest-G03 | Room transition retains inventory exactly once. | not_run |
| clockwork-quest-G04 | Rive face is not treated as 3D skeletal animation. | not_run |
| clockwork-quest-G05 | Save during dialogue restores branch and speaker. | not_run |
| clockwork-quest-G06 | XR entry preserves current path/room and resumes only on confirmation. | not_run |

## Release evidence

Record rules/content and dependency versions, actual asset names/hashes, desktop browser, real phone and (where required) Galaxy XR build, commands/logs, complete-playthrough result, save restoration result, multiwindow/late-disposal behavior, frame timing and unresolved defects. Exercise actual Rive properties and texture input rather than substituting an HTML mock.

A pure rules unit test, a visual smoke test and a hardware XR test are different evidence. Preserve that distinction. All promised features must be demonstrated or explicitly left incomplete; do not relabel a generic engine scene as the finished game.
