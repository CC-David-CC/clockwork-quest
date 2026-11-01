# Controls — Clockwork Quest

All columns produce the same game intents. These mappings are design targets, not tested input bindings.

| Command | Desktop | Phone | Headset |
|---|---|---|---|
| `move` | WASD or click destination | Tap destination | Ray-select floor destination; player is the miniature character |
| `interact` | E / click labeled object | Context button | Select marked object then Interact |
| `view` | Orbit drag | Orbit gesture outside move taps | Natural view; optional recenter |
| `pause-resume` | Escape / Pause or Resume button | Visible Pause / Resume | In-world Pause / Resume |
| `settings` | Settings panel | Scrollable settings sheet | In-world panel; file pickers may require exit |
| `load-save` | Load / Save document actions | Load / Save actions | Authorized slot save; explicit exit for system picker |
| `restart` | Restart after confirmation | Restart after confirmation | In-world Restart with confirmation |

## Input arbitration

A UI gesture is consumed once. Menu/Rive controls do not also fire into the game underneath. Pointer ids own their gestures; cancel/up/blur clears held state. Do not capture arrows/Space while another app or text field is focused. A touchscreen needs no hover or right-click. Keyboard menus retain visible focus.

Responsive layout follows this window's size; phone portrait and landscape must both remain playable, with contextual controls outside the important play area. Hardware gamepads are optional. The headset's native target-ray/select path is the baseline for immersive controls; articulated hands are an enhancement where this app specifies them.

See [phone/input guidance](../../docs/PHONE-AND-INPUT.md) and [common gates](../../docs/ACCEPTANCE-COMMON.md).
