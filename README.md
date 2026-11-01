# Clockwork Quest

Clockwork Quest is a small Babylon.js adventure preview for the Simplified
desktop. Guide Tock through a workshop, clock hall and conservatory, solve two
gated mechanism puzzles and rescue Pip.

## Play

- Move between highlighted destinations with the destination buttons, pointer
  selection in the diorama, or WASD/arrow keys.
- Choose an available interaction and press **Interact**, or press E.
- Escape or the Run/Pause button pauses the adventure. Movement and puzzle
  input require an explicit resume.
- The workshop path requires inspecting the gear and turning the crank.
- The conservatory path requires aligning the minute and hour controls and
  taking the mainspring.
- Unlocking the rescue cage needs the brass key and mainspring and completes the
  adventure.

Save and Open use the signed-in account's **My files**. Saves are versioned
`.game.json` logical snapshots. They include the room, walkable node, inventory,
doors, clock controls, companion state, current dialogue and play time. They
exclude animation frames, geometry handles and XR poses. Loading starts paused.
Changed files, conflicts, malformed input and sizes above 2 MiB are rejected
without replacing the current adventure.

## Presentation and lifecycle

The desktop view owns its Babylon engine, scene, camera, WebGL resources,
animation loop, audio context, file subscription, input handlers and focus
observers. Closing the view disposes only that instance. The game pauses when
its desktop window loses focus, is hidden or rolled up, or when the browser
loses visibility; resume is explicit.

Final glTF character bodies and animation clips are not available. The current
explorer, companion cage and rooms are labeled procedural fallbacks. Final
`quest-faces.riv` artwork is also pending. The implementation exposes model
face mood, speaking, attention and presentation-state values so a reviewed Rive
adapter can replace the fallback without changing game rules.

The optional XR button appears only when the browser reports immersive WebXR
support. It uses the app-owned Babylon XR helper and preserves the same room
and progress. Galaxy XR hardware entry, placement, comfort, in-world file
actions and Rive texture behavior remain unverified.

## Development

```sh
npm ci --prefix apps/system/clockwork-quest --ignore-scripts
npm run typecheck --prefix apps/system/clockwork-quest
npm test --prefix apps/system/clockwork-quest
```

Build the isolated browser bundle with the standard app builder, copy
`tests/clockwork-quest-fixture.html` into the bundle as `index.html`, and serve
the bundle from a loopback-only HTTP server. Then run:

```sh
CODI_CLOCKWORK_QUEST_MANIFEST=.build/clockwork-quest-test/apps.json \
CODI_CLOCKWORK_QUEST_URL=http://127.0.0.1:18364/ \
CODI_TEST_CDP=http://127.0.0.1:19262 \
node tests/clockwork-quest-browser.test.mjs

CODI_PHONE=1 ... node tests/clockwork-quest-browser.test.mjs
```

`tests/clockwork-quest-account.test.mjs` requires the parent integration branch
and an isolated registered-account preview. Physical-phone, audible-audio,
real-headset and complete production-art acceptance remain open.
