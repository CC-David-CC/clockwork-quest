# Clockwork Quest

**Small third-person adventure · Babylon.js · single-player · phone required · immersive XR required**

> Planned design, not implemented or browser-tested. `index.pseudo.mjs` is an explanatory entry point, not a playable game.

## Experience

Guide an animated clockwork explorer through three tiny rooms, solve switch puzzles and rescue a trapped companion.

## What this demonstrates

- glTF character animation blending
- Navigation and interaction state machines
- Lighting, camera composition and Rive character face

## Rules and complete loop

- Tap/click destinations or use movement controls. Three rooms form a compact complete adventure with keys and switches.
- Navigation uses authored walkable regions; no giant open world. A clear interact command is separate from move.
- Companion rescue is the ending. No combat, inventory grinding or procedural quest generator.

## Bounded polished release

Three diorama rooms, six interactions, two path puzzles and one companion rescue sequence.

- Clear walkable boundaries and friendly path indicator
- Body animation follows movement without controlling collision
- Dialogue readable on phone and world panel in XR

No multiplayer, accounts, server simulation or generic editor is required. Start, rules/help, play/activity, pause, outcome/goal feedback and retry must all be complete. Settings include volume/mute, reduced motion, contrast and game-specific options where meaningful. State changes occur in the game model; animations illustrate them.

## Rive inside this app

Expressive face textures on stylized characters plus dialogue cards; body locomotion stays Babylon/glTF. The requested asset is `quest-faces.riv`; it is **not included**. See [RIVE.md](RIVE.md) for the authoring/integration contract. A placeholder or unrelated animated logo does not satisfy this requirement.

## Save behavior

Exact logical adventure state; animations are reconstructed from locomotion/dialogue state. See [SAVE.md](SAVE.md). Loading starts paused; resume is explicit. Entering/exiting XR preserves the live current state even when exported saves are checkpoints.

## Build sequence

Implement the rule loop in [gameplay.pseudo.txt](gameplay.pseudo.txt); bind the exact app lifecycle from [index.pseudo.mjs](index.pseudo.mjs); complete [CONTROLS.md](CONTROLS.md); author/integrate [RIVE.md](RIVE.md); then satisfy [ACCEPTANCE.md](ACCEPTANCE.md). The full XR flow and game-specific presentation are in [XR.md](XR.md).

Target wave: **4**. Integrator first reads [AGENTS.md](../../AGENTS.md); do not guess host APIs from symbolic helper names.

Use original/licensed artwork and audio. Keep the scope small enough to polish; expand content only after the release gates pass.
