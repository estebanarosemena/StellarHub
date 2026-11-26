# StellarHub design review (Impeccable pass, branch `design/impeccable`)

Degraded: single-context (delegated run; no sub-agents allowed, so the design review and the detector evidence were
gathered in one context, design review first). Method: Impeccable 4.10 playbooks `critique`, `polish`, `typeset`,
`layout`, `colorize`, `quieter`, `animate` and the craft floor, read from a local copy. The launcher binary was not
run (no downloads, no hooks, no live mode); the deterministic detector was run with `npx impeccable detect` and
telemetry off. Evidence: headless Edge screenshots of every route in sample mode at 1920x1080 and 1100x700.

Mode: **Operate** (an app the user works in), with one **Experience** moment (Home and the start). The brief is pinned:
keep space / galaxy / stellar, the starfield, the deep-space palette, coral `#FF7A66` + ice `#9ED6FF`, the
planet-with-orbit mark, depth and the cinematic feel. So this is a **refinement**, not a new world: the Orbital system
stays, its details get tightened.

## What already works

- A real point of view. The starfield, the nebula wash, the planet mark and the warp camera between Home and the
  modules make it unmistakably one product; nothing reads as a template.
- A disciplined token base (`--void … --faint`, `--accent/--accent2`, `--f` for motion intensity, density and corner
  presets) and a strict module contract, so a system-wide change can be made in a few places.
- Performance is treated as design: lite mode, intensity steps, idle mode, no per-frame layout reads.
- Copy is plain and specific; destructive actions always have confirmation and undo.

## Priority issues

1. **The stars sit on top of the content.** Panels are a 4–36 % tint, so stars, the nebula and shooting stars show
   through every table row, chart and number. The space is lovely in the gutters and noisy inside the work. Panels have
   no light direction either: one flat fill, one hairline, a shadow below. The surface does not feel like glass or
   like an instrument, just like a darker rectangle.
2. **The display face is spent too low.** Unbounded is a wide, loud display face. It is used for the 34 px headline
   (good) but also for 12.5 px component names, 13–17 px data values and tile numbers, where its width and geometric
   counters cost legibility and make every tile shout at the same volume. Panel titles (`.pan>h4`, 12.5 px muted
   regular) are quieter than the values under them, so the eye has no anchor per panel.
3. **Spring overshoot everywhere.** 65 CSS curves overshoot (`cubic-bezier(.2,.9,.3,1.3/1.4)`, `(.3,1.5,.4,1)`), on
   checkmarks, toggles, chips, tooltips, cards, menus, calendar events. Together with the JS springs
   (`springEase(180,19)`, damping 0.71, about 4 % overshoot) everything wobbles a little. The "alive" feel belongs to
   the dock, the camera and the orbit; on routine controls it reads as jelly, not precision.
4. **Glow and stripe decoration.** Zero-offset coloured glows (admin dot, radar core, next-run dot, pressed keys,
   widget dot), two 3 px side stripes (Autopilot calendar events, changed services in the optimizer), a diagonal
   stripe texture on the "estimate" bar, three blinking live dots. Each is small, together they are the generic
   "AI dashboard" signature the brief wants to avoid.
5. **Contrast of the faint tier.** `--faint #5B6781` is 3.0–3.5:1 on the panels, and it carries real information
   (column heads, hints, sizes, units, dates). It fails WCAG AA for text that size.

## Minor observations

- Home's "Right now" list is spread with `space-around`: on 1080p there are ~60 px voids between rows; rhythm is
  loose while the rest of the screen is dense.
- Hover lifts that move the hovered element itself (`.vcard`, `.tool`, `.vit`, `.pend`) slide out from under the
  pointer near the edge.
- Many near-identical small sizes (10.5, 11, 11.5, 12, 12.5, 13) with no role behind them.
- Toasts are inverted (light on the dark app); they are the only light surface in the product and look pasted on.
- The start screen uses Segoe UI Semibold for the name while the app's brand voice is Unbounded.

## Detector (before)

`impeccable detect stellarhub/ui`: 87 findings. 65 bounce/elastic easing, 12 indeterminate progress sweeps
(deliberate, kept), 3 pulsing dots, 3 zero-offset coral glows, 3 side-tab stripes, 1 repeating-stripes gradient.
The detector agrees with issues 3 and 4; it cannot see issues 1, 2 and 5.

## Plan

Thesis: **observatory glass**. The sky stays alive around the work; the work sits on dark, lit glass.

1. Surfaces: one panel recipe for every frame (panels, sheet, palette, dock, dialogs): a denser deep tint so the sky
   recedes behind content but still reads as depth, a faint top-lit gradient, a 1 px rim highlight on the top edge
   (light from the nebula), and a soft offset shadow. No new backdrop-filter. Lite mode keeps the flat version.
2. Type: Unbounded only from 15 px up (titles, hero numbers, brand). Below that, Onest 600 with tabular figures.
   Panel titles become the panel's anchor (ink, 600). A named role scale replaces the stray sizes in shared pieces.
3. Colour: keep coral and ice exactly. Raise `--faint` to pass AA, cool the hairlines, add derived accent tokens
   (soft fill, line) so states use one vocabulary. Nebula gets a soft vignette for cinematic depth (static, free).
4. Motion: one curve family. `--e-out` (expo out) for arrivals, `--e-snap` (quint out) for controls,
   `--e-io` for travel. JS springs keep their identity on the dock, the camera and the 3D view but are damped to
   ~0.85 so they settle instead of wobbling. Hover moves a child, not the hovered box.
5. Replace decoration: glows become offset shadows or a ring; side stripes become a full tinted border plus a leading
   colour dot; the stripe texture becomes an outlined "estimate" bar; live dots stop blinking (a steady dot with a
   ring). Indeterminate progress sweeps stay.
6. Cover every screen: shared pieces in `base.css` first (they reach all 12 modules), then each module's own CSS
   for the flagged items, Home, Settings, palette, component sheet, toasts, widget, tray and the start screen.

## Result (what changed)

- **Surfaces** (`base.css`): one glass recipe for panels, sheet, palette, dock, toasts, menus, notes and dialogs:
  `--sheen` (faint ice light from above) over the deep tint, `--rim` (1 px top highlight), `--lift`/`--lift-hi`
  (soft offset shadows). "Solid panels" maps to a denser tint (default 1.75 now ~78 % deep instead of ~64 %), so the
  stars recede behind content and stay bright in the gutters. Toasts are dark glass with a small planet signifier
  instead of the inverted light pill. Tab and segmented indicators are lit glass.
- **Type**: role tokens (`--fs-*`). Unbounded only from 15 px up: tile names, kit titles, backup and release-note
  headings and small values moved to Onest 600. Panel titles, settings labels, palette groups and table heads gained
  weight so each group has an anchor. `text-wrap: balance/pretty` on headings, empty states and descriptions.
- **Colour**: coral and ice unchanged. `--faint` `#5B6781` -> `#7683A0` (now >= 4.5:1 on panels), `--mute` one step
  lighter, hairlines a touch cooler; dusk theme adjusted the same way. Derived `--acc-soft/--acc-line/--ice-soft/
  --ice-line`. Nebula: one extra coral core and a faint ice horizon under the dock (static gradients, no filter).
  Text selection and caret themed.
- **Motion**: 73 overshoot curves -> `--e-snap`/`--e-out`; `SH.EASE.spring/soft/snappy` damped from ~0.71-0.78 to
  ~0.84-0.87 (the dock, camera and 3D springs keep their own constants). Hover no longer moves the hovered box on
  settings cards, tools, Home vitals and pending rows.
- **Decoration replaced**: zero-offset glows -> rings or offset neutral shadows (admin dot, radar, next run, driver
  age, routine dot, pressed key, UAC level, RAM sticks, widget and tray dots, primary buttons, controller ring);
  Autopilot calendar events -> full tinted border plus a leading colour dot; changed services -> tinted, outlined row;
  estimate bar -> hollow outlined bar; live dots -> steady dot with a ring ("in use now" calls twice when it
  appears, then rests). Indeterminate progress sweeps unchanged.
- **Signature**: the dock marks the active module with the brand mark in miniature (a coral planet on an ice orbit).
- **Start screen**: the name is set in Unbounded 500 (bundled woff2, like the installer art), Segoe UI fallback.

## Detector (after)

`impeccable detect stellarhub/ui --no-design-system` (same rule set as before): 13 findings, down from 87:
12 indeterminate progress sweeps (kept on purpose) and 1 repeating gradient that draws the gold contacts of the RAM
stick illustration in Live Monitor > Memory (an illustration, kept). With the new DESIGN.md the detector also checks
conformance to the documented scale and reports ~500 advisories (off-scale radii, colours and sizes in module CSS):
a follow-up token cleanup, not part of this pass.

## Follow-up pass: tokens, layouts, headers, icons, charts, empty states

Detector, `impeccable detect stellarhub/ui` with DESIGN.md: **510 -> 72** findings (327 radius, 102 colour, 63 font-size
and 5 font advisories before). The 13 findings of `--no-design-system` (12 indeterminate sweeps, 1 RAM contact
gradient) are unchanged. What remains is outside module CSS: the top bar and Home (`home.css`, `bento.css`,
`model3d.css`), the stand-alone tray and widget pages, the component sheet's corner demo, the hardware illustration
pigments (publisher tiles, test pattern, monitor stand) and the keycap size clamps.

- **Tokens**: radii `--r-xs/-s/-m/-l/-pill` (so the corner presets reach every module), spacing `--sp-xs..xl` for
  gaps, type `--fs-cap..h1` plus display numerals `--fs-n1..n4`, icon sizes `--ic-xs..3xl` and one stroke `--ic-w`.
  DESIGN.md documents the full scale and the black / scrim / white tones, so the check reads them as part of the system.
- **Icons**: one 1.4 px line at every size (non-scaling stroke), seven sizes; 366 per-module sizes moved to the tokens.
- **Layouts**: panels next to others hug their content (a short list never leaves an empty frame), grids use
  `auto-fit` (Optimizer > Registry with one group now spans the width; Hangar kits cap at four columns; Privacy >
  Protection balances its cards), Benchmark component tabs hug their results.
- **Headers**: one structure (title, description, actions right, tabs below) already came from the shell; the actions
  row now has one height and spacing for buttons and chips.
- **Charts**: `SH.chartKit` (core.js) draws gridlines, y labels, x labels, cursor and tooltip for Live Monitor, the
  battery chart and every Benchmark chart (history and stress, which gained a hover tooltip).
- **Empty states**: `SH.emptyState` / `SH.emptyArt`, four small orbit scenes (all done, nothing found, nothing yet,
  could not read), one line, one next step where it makes sense; every module uses it.
