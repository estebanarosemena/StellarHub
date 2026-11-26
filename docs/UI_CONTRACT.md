# StellarHub UI contract

How to write a module or a Home view without breaking the rest. Everything hangs off `window.SH` (see `ui/js/core.js`).

## Files

| Piece | JS | CSS |
|---|---|---|
| Module `<id>` | `ui/js/modules/<id>.js` | `ui/css/modules/<id>.css` (everything prefixed with `#v-<id>`) |
| Home view `<id>` | `ui/js/home/<id>.js` | `ui/css/home/<id>.css` (everything prefixed with `.hv-<id>`) |

They are already linked in `index.html`. No external resources: everything is local (three.js lives in `ui/vendor/three.module.min.js`).

## Modules

The master list (name, icon, description, tabs) is in `SH.MODS` (core.js). The shell creates the view, the header, the tab bar with its indicator and one `.tab` container per tab. The module only fills them in:

```js
SH.module({
  id: 'drivers',
  actions(el, ctx) { /* header buttons, to the right of the title */ },
  renderTab(tabId, el, ctx) { /* called ONCE, the first time the tab opens */ },
  enterTab(tabId, el, ctx) { /* every time it is shown */ },
  leaveTab(tabId, el) {},
  enter() {}, leave() {},
});
```

`ctx`: `go(id, {tab})`, `setTab(id)`, `tabEl(id)`, `setBadge(tabId, n)` (number on the tab), `el()` (the section).

- A tab can be hidden by a condition: a third item in its `SH.MODS` entry, `['registry', 'Registry', () => !!SH.state.settings.registryCleaner]`, or `when` on a tab object a module declares itself. While it returns false there is no tab button (`hidden`), no palette entry and `#mod/tab`, `setTab` and `go(id, { tab })` ignore it; its panel is still built but never shown, and `*` walks only the visible tabs. The shell re-checks every condition when any setting changes (`SH.on('setting')`) and after import or reset, and moves off a tab that just went away. Palette actions (`SH.actions.add`) take the same `when`. Modules must not show or run anything for a hidden tab (no badges, no scans, no palette actions).
- `.tab` is `position:absolute; inset:0; overflow:auto`. For a full-screen layout with its own internal scrolling, add the `fill` class to the tab's `el`.
- Compact layout: below 1100 x 700 CSS px (`SH.zoomRule.compact`, js/zoom.js), shell.js sets `html[data-layout=scroll]`
  (`"fit"` otherwise, `SH.layout`, event `layout`). The `.view` then scrolls as one page and `.mod` (Home: `.home-grid`)
  is at least as tall as in a 760 px window (`--fit-h`), so a tab's fit-to-height layout keeps its room and nothing is
  clipped; the page ends with `--dockspace` free so the last row scrolls clear of the dock. A module needs no code for
  it; for a narrow window (`@media (max-width:1099px)`) its multi-column grids must reflow so nothing is cut at the
  right edge. Lists that scroll inside a panel must not use `overscroll-behavior:contain` there (the wheel goes on to the
  page at their end). Do not measure `innerHeight` to size a layout: measure the element.
- Anything marked `data-asm` inside a tab staggers in the first time (the shell does it).
- Per-frame loops: `SH.tickers.add((dt, t) => { if (SH.state.view !== 'drivers') return; ... })`.
- Live data: `SH.tele.v` (values), `SH.tele.hist[key]` (120 values), `SH.tele.on(fn)`.
- Before anything that needs administrator rights: `if (!SH.requireAdmin('to install drivers.', { resume })) return;`.
  In normal mode it opens the administrator prompt (`js/admin-resume.js`, `.ar-o`: a dialog in the middle, A = Open as
  administrator, B / Esc = Not now) and answers false. Open as administrator reopens StellarHub elevated for this
  session only (its unticked "Always open as administrator" box, ticked, also turns that setting on) (start-screen
  handover; Windows asks first; a task the user started that still runs blocks it) and the new copy comes back to the
  same place by itself: module, tab, settings section, Home view, the text of `input[id]` search fields and the
  scroll of the view, the tab and any scrolled element with an id. `resume: { action: 'drivers.install', args: { ids } }`
  also runs that action again there. An action is registered by its module, `SH.resume.register('drivers.install',
  async (args, r) => ...)`, and must be listed in `ACTIONS` in `stellarhub/resume.py` (a test keeps both lists equal).
  It rebuilds the click from the module's state now: it looks every id from `args` up in what the module lists (args
  come from a file any user-level program can write, so they are never trusted), clicks the same button so its usual
  confirmation is asked again, and returns false when what it acted on is gone or changed (the user is told; nothing
  runs). `r`: `open(mod, tab)`, `until(fn, ms)`, `str` / `strs` / `num`, `wait`. Work that can go on without the rights
  (the steps that need them are skipped) uses `await SH.adminFirst(reason)` before it starts: true to go on, false
  when StellarHub is reopening. The ticket: `stellarhub/resume.py` (two minutes, read once, bound to the elevated
  copy's command line by its hash). Sample mode simulates it (the page reloads as a pretend administrator copy;
  `?uac=deny` pretends Windows said no; `?normal=1` makes the modules that only ask inside the app ask in sample mode).
- Confirmations: `SH.toast('Done', { action: { label: 'Undo', run } })`. No `alert`/`confirm`.
- Palette actions: `SH.actions.add([{ t: 'Text', go: 'drivers', tab: 'backup', ic: 'download' }])`.
- Icons: `SH.ic('name')`; add new ones with `SH.icons.add({ name: '<path d="..."/>' })` (24×24 stroke, no fill, no `stroke-width` of their own: the 1.4 px line comes from `svg.i`). Size them with the `--ic-*` tokens.

## Shared pieces (base.css)

`.pan` (frame), `.btn` (`pri`, `sec`, `ghost`, `danger`, `sm`, `lg`), `.seg` + `.ind` (move it with `SH.placeSeg(seg)`), `.toggle`, `.check`, `.chip` (`ok`, `warn`, `bad`, `acc`), `.field`, `.bar>span` (with `transform: scaleX()`), `.rows/.row/.ri/.rt`, `.tbl-head`, `.empty`, `.sk` (skeleton), `.big`, `.muted`, `.faint`.

- Empty states: always `SH.emptyState({ art, title, text, action, small, cls })` (returns HTML, `.empty.es`). `art` is `ok` (all done), `none` (nothing found), `first` (nothing yet / first use) or `error`. `action` renders one button: `{ label, id?, data?, go: 'module/tab', click: '#selector', icon?, pri? }`. `SH.emptyArt(art)` is the bare illustration for covers that keep their own layout. Never write a bare sentence in a blank panel.
- Canvas charts share `SH.chartKit` (grid, y/x labels, tooltip, cursor): `grid(x,L,R,T,B,n)`, `ticks(x,L,T,B,n,hi,lo,fmt)`, `xlabels(x,L,R,h,a,b)`, `tip(x,px,W,T,[[color,text],...])`, `cursor(x,px,T,B)`; reserve `chartKit.xpad` px under the plot for the x labels.
- Panels reach the dock: the columns of a tab stretch to its bottom and line up with their neighbours (a short list
  scrolls inside a full-height panel instead of leaving an empty band under it), and an empty or idle state fills its
  panel or column with its content centred. Grids use `repeat(auto-fit, minmax(...))`: no cell hanging in a corner.
- Hover: everything that can be clicked (buttons, tabs, rows and cards that act, switches, checkboxes, selects) shows a
  calm hover in the shared language (a raised fill, a lighter edge or ink colour, the pointer cursor); plain text never.
- Toasts (`SH.toast`) live bottom right and never cover the content, the dock, its magnified icons, the hint bar or the
  version tag, and never sit in the top bar (shell.js placeToasts): beside the dock, to its right, the newest centred on
  the dock bar (never lower than its bottom edge), older ones stacking upward only up to the strip the page keeps free
  for the dock (`--dockspace`). A narrow window gives the lane the width there is (at least 200 px) and the text wraps.
  Only when even that is missing (a compact handheld layout): one slim bar centred just above the dock and the hint
  bar; `html[data-toasts=above]` then raises `--dockspace` for good (and fires `resize`), so it never covers a panel.
  Only what fits in the lane stays up: the oldest leave first, the newest is always shown. With a controller, X runs the newest toast's action. A toast refreshed by the same
  message (or `group`) runs the newest call's action.
- The version tag (`.ver-tag`, bottom left of every view, shell.js) is plain text that never takes the pointer; only the
  report-a-bug icon to its left (`#bugBtn`) does: it opens a small popover (`.bug-pop`) whose button opens a new GitHub issue.
- `SH.lastRun` lays out its own children (a fixed 28 px clock, then the text column): a module's `cls` only adds
  spacing, and must not be a class the module already uses for something else.

Tokens: `--void --deep --raise --raise2 --raise3 --line --line2 --ink --mute --faint --accent --accent2 --on-accent --ok --warn --bad --display --text --r-l --r-m --r-s --r-xs --r-pill --sp-xs..--sp-xl --fs-cap..--fs-h1 --fs-n1..--fs-n4 --ic-xs..--ic-3xl --ic-w --f` (multiply CSS durations by `var(--f)`). Module CSS uses the tokens for radii, type sizes and icon sizes, never literals (the corner presets reach every module that way).

## Animation

- `SH.anim(el, keyframes, { d, delay, e })` (WAAPI with the intensity applied; interrupts the previous one). `SH.EASE.out | io | spring | soft | snappy`.
- `SH.Spring(v, k, c)` with `.t` (target), `.step(dt)`, `.set(v)`. Interruptible by nature.
- Only `transform`, `opacity`, `filter`, `clip-path`, `stroke-dashoffset`. Quick ones: 83/167/250 ms; large ones ≤ 500 ms. Never `ease-in` on entry.
- Respect the intensity (`max`, `normal`, `min`): at `min`, nothing loops. Read it with `SH.effInt()`, never `SH.state.settings.intensity` (see "Lighter effects on battery"); `SH.motion()` already applies it.

## Sounds

`SH.sound(event, opts)` (core.js) plays `ui/sounds/<event>.ogg` (or the file its `f` names, or one of `<event>_1..n`
at random for an event with `n` variants, never the same twice in a row, or `<event>_<opts.step>` for one with
`steps`); the 40 events are the keys
of `SOUND_EV`, each with its group, gain trim (set from the file's loudest 100 ms), minimum gap and priority.
`navigate` (a module change from the dock, the palette or a shortcut; `go()` in shell.js plays it) is two sounds:
`navigate_click.ogg` at once and, 20 ms later, one of seven soft swooshes (`navigate_swoosh_1..7.ogg`, `SWOOSH` in
core.js, each with its own trim, about 7 dB under the click) that goes with the view's transition; they take turns, so
two changes in a row never sound the same. The swoosh follows the click (no click, no swoosh), never cuts another
sound and stays at intensity `min`, where the transition is shorter but still there. `SH.sound.files(event)` lists
the files an event plays. `js/sounds.js` already gives every
module, with no code: a click on buttons, links, dock items and rows (pointer or controller A), `toggle_on/off` on
`.toggle`, `tab_switch` on `.seg` and `.subnav`, `panel_open/close` for the dialogs in gamepad.js's `MODALS`,
`dropdown`, `hover` (dock items, buttons, Home tiles, rows that are buttons), `hover_soft` (every other clickable
thing: tabs, segmented choices, switches, checkboxes, rows and cards that act, selects, links, sliders; never one
inside a `hover` element, never right after a hover), `unavailable` on a disabled button, `navigate`, `palette_open`,
`key_type` while typing in the palette, `toast` and the start/exit sounds. A row, list item or card that is a plain
element (a div) and lights up under the pointer (a `:hover` in its CSS) goes in `ROWS` in sounds.js (hover_soft); if
its own click does something (select, expand, mark) also in `ROW_ACTS` (click). A new `:hover` must be one of those, a
real control, or listed as decorative in tests/test_sounds.py (`HoverSounds.DECOR`), or the test fails. The tray
panel has the same hover/hover_soft/click in tray-panel.js (it doesn't load sounds.js); the widget stays silent (it
floats over games and other apps). A module adds only what means something specific:

- `SH.toast(text, { kind: 'success' | 'warning' | 'error' | 'unavailable' })` (no kind: a plain toast, which keeps
  quiet right after another sound); an Undo action carries `sound: 'undo'`.
- `SH.job(mod, fn, args, { sound: 'scan' })` for a scan the user started (scan_start, scan_complete, soft ticks at
  25/50/75 % when it runs long); `sound: 'task'` for another long user task (ticks only). Background refreshes pass
  nothing.
- `SH.sound('delete' | 'undo' | 'refresh' | 'copy' | 'achievement')` at that moment.
- `SH.sound('map_hover')` for a pointer that moves onto a different tile of a map (Storage's treemap): only on a real
  mouse movement, never while the map zooms, reveals or the wheel turns.

Dialogs: every one closes with exactly one `panel_close` however it closes (its X or Cancel, a click on the backdrop,
Esc, the controller's B). For the `MODALS` dialogs sounds.js does it: a dialog counts as closed the moment its
fade-out starts (an animation to `opacity: 0` on it or on one of its children), so a new dialog needs only to fade out
before it goes. The palette and the settings sheet play their own; a close that leads somewhere (a palette item, a
"go to module" button) stays quiet with `SH.sound.claim()` and lets the destination sound.

Interface events (group `soundUi`): `click`, `hover` (70 ms apart), `hover_soft` (90 ms apart, about 8 dB under
hover; both only when the pointer enters from outside with a real mouse movement, never while the page scrolls or in
controller mode), `tab_switch`, `navigate`, `dropdown`, `palette_open`,
`focus_move`, `panel_open`, `panel_close`, `toggle_on`, `toggle_off`, `key_type` (a printable key or Backspace in the
palette search: not modifiers, not held-key repeats, not during IME composition; 30 ms apart) and `map_hover` (35 ms
apart, quieter than hover).

The loading loop (group `soundTasks`): `loading.ogg`, one seamless 2.1 s sonar cycle, plays with `loop = true` while a
loading indicator is on screen (`LOADING` in sounds.js: Driver Updater's radar, the Optimizer's analysis ring and its
"Loading…" panels, Privacy's radar and quick scan, Storage's scan dial, Remover's leftover search, Updater's checks,
skeleton rows, the Hangar catalog's placeholders, any skeleton block 100 px tall or more). On screen means in the
module in view, rendered, inside the window and its scroll boxes and not covered at its middle (the palette, a dialog,
the Settings sheet). It starts after 400 ms (a quick load stays silent), goes on across re-renders, and fades in about
150 ms when none is left: the work ended or failed, another module or tab, scrolled away, covered, the window hidden.
One loop however many indicators. A notification or a finished task (`scan_complete`, `success`, `error`...) only ducks
it for 700 ms (it may be another module's work, ended in the background): it comes back if an indicator on screen still
asks for it, and ends if none does; only the end of the visible indicator stops it. A new loading state adds its
selector to `LOADING`; spinners in buttons and the progress bars of installs, cleanups and tests stay out (they have
their own progress and sounds), and so does the benchmark's loop (it has its percent steps). `SH.sound.loop(on)`,
`SH.sound.looping` and `SH.sound.ducked` are the engine's side (core.js). `SH.onScreen(el)` is the visibility test.

Counters and percentages (group `soundTasks`, only for an element on screen): `count_tick` ("blip"), a muted dry blip
for each visible change of a number fed to `SH.rollNumber(el, n, { tick: true })` (Storage's files read), at most ~12 a
second, one of `count_tick_1..4`, never the same twice in a row (`{ sound: false }` keeps a counter quiet);
`percent_step` ("glass pluck"), `SH.rollNumber(el, text, { percent })` (the Benchmark score): each time the number
painted on screen is a higher whole percent, `percent_step_<step>.ogg` plays in that same call (step = min(8,
floor(pct × 9 / 101)), nine pitches at equal loudness, E major pentatonic E5 to B6), so the pitch always matches the
number shown; one inside its 85 ms gap is dropped, never queued; going down or starting again says nothing.

Rules: one sound per user action. Interface sounds need a click, key or controller press in the last 1.5 s, and the
first one within 100 ms wins, so a sound that belongs to a click must be played synchronously in the click handler
(before any `await`); if it can only come later, call `SH.sound.claim()` in the handler and play it when ready. A
plain toast shown by the handler of a control that has its own sound (a switch's `toggle_on`/`toggle_off`, a new
choice, a pointer click) stays quiet: the control speaks. A
notification (success, error, a finished scan) replaces a click that began in the last 100 ms. Nothing plays while
the window is hidden. Settings: `sounds`, `soundVolume`, `soundUi`, `soundAlerts`, `soundTasks`, `soundSystem`
(Settings > Sound); lighter effects and intensity `min` mute nothing.

## Long work (activities)

Anything long a module does (a scan, an analysis, a cleanup, a queue of installs, a test, a routine, a backup, and
also what starts by itself when a module or a tab opens) is an activity, so it can be followed from anywhere
(`SH.activity`, core.js):

```js
const h = SH.activity.start('storage', { key: 'scan', label: SH.t('Scanning {name}', { name }), go: { tab: 'map' } });
h.progress(.38);                 // 0..1, or null while it cannot be measured; a second argument replaces the status text
if (!h.end({ ok: true, summary: SH.t('{size} in {n} files', { size, n }) })) SH.toast(/* the module's own result */);
// h.end({ ok: false, error }) / h.end({ cancelled: true })
```

- While it runs and the user is elsewhere, the module's dock icon wears a thin ring (filled to the progress, a short
  arc in a slow orbit when there is none) and its tooltip says the status; Home's To review panel shows it as a live
  row; the palette's module row shows the percentage; the taskbar button shows the progress of every running activity
  together (indeterminate if any has none, red for a moment when one fails; `stellarhub/taskbar.py`).
- When it ends while the user is elsewhere, `end()` shows a toast with **View** (the window hidden in the tray or
  minimized gets a Windows notification instead, whose click opens the module), leaves a badge on the dock icon until
  the module is visited, and returns `true`: the module then skips its own result toast. Looking at the module, it
  returns `false` and says nothing (the module's own result UI answers). Cancelled: nothing at all.
- Several per module (`key`); the newest is shown. The same `key` while one is open returns that one.
- Exactly one sound: a toast after a sound played in the last 0.7 s (the job's `scan_complete`) stays silent. `kind`
  sets the toast's kind (`'achievement'`, `'warning'`); `toast: false` keeps the badge and the notification but leaves
  the toast to the module (Scheduled Tasks' own, the `autopilot` module, has View the log).
- Work that starts by itself (a list read on opening a tab, Program Updater's light check at start-up, and the
  analyses when "Analyze automatically when opening a module" is on: see below) passes `bg: true`: it is followed exactly the same
  way, but only once it has run for 1.5 s (`grace`), so a quick refresh never flashes a ring and ends without a word.
  It plays no start or end sound of its own (the toast when it ends elsewhere does). The user starting the same `key`
  while it runs makes it theirs at once. A refresh the user never needs to hear about (the light check at start-up,
  the list read again after an install) opens nothing; `user: false` is never shown.
- `SH.activity.follow(mod, promise, { key, label, go, summary: v => text })` follows a promise as a `bg` activity and
  returns it (rejected: it failed; an error with `cancelled: true`: nothing).
- `SH.job(..., { sound: 'scan' | 'task' })` opens one by itself (its progress and text, a generic summary) unless the
  module already has one open; `{ bg: true, label }` does the same for a job without a sound (work the module started
  by itself, or a secondary step); `{ activity: h }` sends a job's progress to the module's own, `{ activity: false }`
  opts out.

## Analyses on demand

Opening a module or a tab never starts an analysis (a scan, a measurement, a check, a search for updates): it runs when
the user presses its button (Analyze, Scan, Check now, Check for updates…), with the user's sounds (`scan_start`,
`scan_complete`) and a user activity (ring, badge and toast with View when it ends elsewhere). Plain reads needed to
draw a view stay automatic (Program Remover's program list, Driver Updater's drivers, problems and history, App Hangar's
installed state, Live Monitor, Home), and so do the routines of Scheduled Tasks and Program Updater's light check at start-up
(winget only, every 6 h at most, for Home's counts).

- Before the button is pressed the view shows the last results if there are any, marked with their age: `SH.lastRun({
  when, title, text, action, cls })` (core.js) is the strip that goes above them (a clock, "Last analysis: 2 h ago" or
  the module's own sentence with `{when}`, and the primary button); `SH.ago(ms)` is the age alone. Without results it
  shows `SH.emptyState({ art: 'first', … })` saying what the analysis does, with the button (`action.big` for a
  full-size one). Measurements that must not be shown stale (cleanup sizes, the registry list, the treemap) say "Not
  analyzed yet" instead.
- Where the last results come from: Storage Checker, the engine's snapshot of the last scan of the drive
  (`storage.last_scan`: date, size and files; the map itself needs a new scan) or the scan this process already has
  (`storage.published`, after a page reload); Super Optimizer, `localStorage` (`sh.opt.cache.*`: the Overview, Startup
  and Services); Privacy & Security, the engine's cache (`privacy.cached`); Program Updater, `localStorage`
  (`sh.upd.cache.apps|win|dev`, the icons dropped if storage is full). Results from an earlier session are never
  published as a new check (`SH.setPending` keeps the date of the last real one), and the live views of Privacy
  (network, permissions) refresh by themselves only after a check in this session.
- Settings > General > "Analyze automatically when opening a module" (`autoAnalyze`, default off; `SH.autoAnalyze()`)
  brings back the old behaviour: the analysis starts on opening, quietly and followed as `bg`.

## Lighter effects

The interface does less work when "Lighter effects" (setting `lightMode`) says so: `'auto'` (default: on battery, or when the page renders on an integrated GPU), `'always'` or `'never'`. The old boolean `batterySaver: false` maps to `'never'` (core.js does it when `lightMode` was never saved; `batterySaver` itself is kept in step for older readers). `js/telemetry.js` decides it (desktops, which report no charge state, are never on battery) and sets:

- `SH.state.lite` (boolean) and `html[data-lite="1"]` (`"0"` otherwise) for CSS. `SH.power.onBattery` says whether the PC is on battery at all; `SH.power.igpuOnly` whether the only graphics adapter is integrated; `SH.power.set(true | false | null)` forces the battery state in tests.
- `SH.on('power', ({ lite, onBattery, igpuOnly }) => {})`: fires only when `lite` changes. Rebuild or stop whatever depends on it (the shell, the starfield and the 3D view already do).
- `SH.effInt()`: the intensity the animations must use. It is the user's choice (`SH.state.settings.intensity`, which stays untouched in the settings) one step lower while `lite` (`max` becomes `normal`). Use it for every question about animation strength (`SH.effInt() === 'min'`, `SH.motion()`, `--f`); read `state.settings.intensity` only to show or save the setting itself.
- CSS: put the cheaper version under `html[data-lite="1"]`: no `backdrop-filter`, no big blurs or masks, no looping decoration (see the block in `base.css`). The telemetry rate drops to one sample every 2 s and the engine skips its slow extras.
- Per-frame loops check `SH.state.lite` (or `SH.effInt() === 'min'`) and stop; a hidden window (tray) already pauses every loop and uses no GPU.
- Idle tracking (shell.js): `SH.poke()` marks activity (mouse, keys, touch and the gamepad call it), `SH.idleFor()` is the ms since the last one and `SH.isIdle()` is true after 8 s without any. `html[data-idle="1"]` (`"0"` otherwise, checked once a second) lets CSS drop its own decorative transitions while nobody is using the app; the starfield already redraws less when idle. Do not start work in an idle callback that the user would notice when they come back. Home left alone (idle, nothing open over it) ticks at ~20 a second and the loop sleeps on a timer between ticks: ambient motion there must be a ticker (no endless CSS or WAAPI animation, which runs at the screen's refresh rate).

## Controller navigation

`js/gamepad.js` + `css/gamepad.css` let the whole app be used with a gamepad (standard mapping: Xbox-style pads, handhelds such as the ROG Ally). It polls with `requestAnimationFrame` only while a controller is connected, the window is visible and focused, and Settings > General > "Controller navigation" (`gamepadNav`, default on) is on; otherwise nothing runs. Modules need no code for it: buttons, links, tabs, inputs, `[role=button]`... are found by themselves and the ring moves between them with spatial navigation. Use real `<button>`s, give clickable `div`s `tabindex="0"` and a role, and keep the focus order sensible.

| Button | Action |
|---|---|
| D-pad / left stick | Move the focus (the ring follows it) |
| A | Select (click) |
| B | Back: closes the dialog on top, else goes back / Home |
| LB / RB | Previous / next tab (settings section inside Settings) |
| LT / RT | Previous / next module |
| Y | Search (palette) |
| Menu | Settings |
| View | Home |
| X | The newest toast's action (View, Undo) |
| Right stick | Scrolls what the user is in (the panel entered, else the page), analog speed; the focus stays |

- Panels that scroll ("windows"): any area with its own vertical scroll (a list, a text panel) that is not the page
  itself (`PAGE` in gamepad.js: a view, a tab, the settings body and section list, the palette, a dropdown, a dialog's
  whole body) is ONE focus stop from the page (the ring wraps it; the hint says A Enter). A goes inside: a calm frame
  (`#padPanel`) marks it, the D-pad moves among its items (or scrolls it when it has none: text), LB / RB page
  through it, B leaves it (focus back on the panel). A panel that goes away or stops scrolling is left by itself.
- After any scroll the focus did not follow (right stick, wheel, touch), the next D-pad move starts from what is on
  screen (the nearest visible item that way), never scrolling back to the old focus. Going down, the page's own
  content (scrolled into view, clear of the dock and the hint bar) comes before the dock.
- What can take the focus: visible, enabled, not `inert` / `aria-hidden`, not see-through unless it is a real control
  shown on hover (gamepad.css shows it while focused), not clipped away, not empty (no text, picture, label, fill or
  edge) and not a layout box (more than 45 % of the window). Give icon-only buttons an `aria-label` or `title`: the
  controller shows it under the ring (`#padTip`). Returning to a module restores its last focus.
- A text field opened with A asks Windows for its touch keyboard (`touch_keyboard`, `winmgr.show_touch_keyboard`).
- Keyboard parity: Page Up / Down and Home / End scroll the innermost area around the focus that can still move that
  way (a list, then the page).
- `html.pad-mode` is on while a controller is in use; a mouse move, a touch or a key press turns it off. The ring (`#padRing`) and the hint bar (`#padHints`) exist only then. While the hint bar is up, `html.pad-hints` raises `--dockspace` so it never covers content; the page gets a `resize` event when it comes and goes, so views that measure themselves must re-fit on `resize`.
- `SH.gamepad`: `enabled()`, `active` (controller mode is on), `inside` (the panel entered, or null), `debug` (targets and moves, for tests), `connected` (list of pads), `focus(el)`, `move(dir)`, `onButton(fn)` (every press: `{ index, name, pad }`; returns the unsubscribe), `capture({ onExit, onProgress })` / `release()` / `captured` (a test that needs the raw buttons, such as Device Tester > Controller; the user gets the navigation back by holding View + Menu for a second), `addOverlay(selector)` (a custom dialog the focus must stay inside), `glyph(name)` and `BUTTONS`.
- `SH.modal`: whichever dialog is on top (palette, settings, component sheet, update dialog, confirmations and `.mdlg` / `.hg-dlg` / `.bk-dq-o` / `.dq-o` / `.u-confirm` dialogs inside a module, the report-a-bug popover `.bug-pop`, the administrator prompt `.ar-o`) gets a focus trap: the rest of the app becomes `inert`, Tab and the D-pad stay inside, and the focus goes back to what opened it when it closes. This works for keyboard users too. A new dialog class must be added to `MODALS` in gamepad.js (or registered with `SH.gamepad.addOverlay`), and should carry `role="dialog"` and `aria-modal="true"`. `SH.modal.open` is the current dialog, `SH.modal.sync()` re-checks after you open or close one without a class change.
- Animations of the ring use `transform` only and run only while it is visible; at intensity `min` nothing loops.

## Settings safety

`SH.loadSettings()` never trusts the saved file: every key with a default keeps the default's type (numbers inside their range, `intensity` one of the three values) and the lists and maps the modules store (`activity`, `autopilotRoutines`, `hangarKits`, `pending`, `updIgnored`...) must have their shape; anything else falls back to the default (or is dropped) key by key. A new setting that is a list, a map or a number with limits goes in `DEFAULTS` (or `SHAPE` / `RANGE` in core.js).

### Registry cleaner (opt-in)

Microsoft advises against registry cleaners, so the one in Super Optimizer is off by default: setting `registryCleaner` (boolean, default `false`), Settings > General > "Registry cleaner". Off: the Registry tab is hidden (see the hidden-tab condition above), the overview has no registry area or ring segment, the analysis does not scan it, and there is no badge or palette action. On: the tab and its area work as always, but the registry is never a step of "Optimize everything" (nor of its undo), and Scheduled Tasks has no registry action. Undo never depends on the setting: registry backups stay listed and restorable in Settings > Backups and restore (`engine/backups.py`) with the cleaner off.

Migration: when `registryCleaner` is not in the saved file (an upgrade from before it existed), `loadSettings` asks the engine `optimizer.registry_backups_exist` (read-only: any folder under `registry/` in the ProgramData or user optimizer data); it becomes `true` only if the user already has registry-fix backups, `false` otherwise, and it is saved so this runs once. Reset settings saves `false` explicitly, so the migration never turns it back on.

## Home views

```js
SH.homeVariant({
  id: 'xray', name: 'X-ray', short: 'X-ray', desc: 'One line',
  mount(el, ctx) { /* draws inside el (it fills the central stage). ctx.intro=true: play your entrance */ },
  unmount() { /* remove tickers and listeners */ },
  resize() {}, onReturn() { /* when coming back to Home from a module */ },
});
```

`ctx`: `PC` (model and `components` with id, name, title, rows, bar; it is refreshed in the background every 30 minutes, see below), `tele`, `openComponent(id)` (opens Live Monitor on its tab), `motion()`.

## Real engine (Python)

Each module has `stellarhub/engine/<id>.py` with `EXPORTS` (quick calls) and `JOBS` (long tasks that receive `job`).

```js
const list = await SH.engine('drivers', 'list');                  // undefined outside the app: use sample data
const r = await SH.job('drivers', 'search', [], { onProgress: m => {/* m.pct, m.text, m.data */}, onLog: lines => {} });
// the promise has .cancel()
SH.setPending('drivers', 4);   // feeds "To review" on Home (keys: drivers, apps, junk)
SH.logActivity('Drivers updated', { sub: '2 installed', ic: 'drivers', go: 'drivers', tab: 'history' });
```

- Infrastructure: `engine/jobs.py` (progress, live log, cancel), `engine/ps.py` (PowerShell and consoles in UTF-8, with live output), `engine/telemetry.py` (real telemetry → `SH.tele.push`), `engine/system.py` (PC data, health, displays and screenshots), `engine/removal/` (engine inherited from MiniRevo: programs, icons, leftovers, quarantine, cleanup, startup).
- Nothing starts `powershell.exe` by itself (start, telemetry, Home's pc_info/health, the drivers count, Scheduled Tasks' metered-connection check): those read WMI in-process through `engine/wmi.py` (System.Management via pythonnet: `system._query_wmi`, `system._health_wmi`, `drivers._inventory_wmi`) or COM (`autopilot._metered_com`), keeping the PowerShell script as the fallback if WMI fails. PowerShell is for what the user triggers (Program Updater, Debloat, firewall, Defender scans...); a new background feature must not add a spawn.
- Install and update modes (`engine/selfupdate.py`): installs are per-user by default (`PrivilegesRequired=lowest` in `StellarHub.iss`, `%LOCALAPPDATA%\Programs`) and update **directly** (no admin, no task). An all-users install updates through the on-demand `StellarHub\Update` task if it exists ("task"); without it the mode is "uac": the first update asks Windows once (only from the Update button or the start-time staged install; `prefetch()` and `start(allow_uac=False)` never prompt, so a new-features version shows the update window instead of staging) and the elevated updater creates the task (`_make_task_if_missing`), so later updates are silent. The installer no longer creates the task; the uninstaller deletes only the tasks that start that copy.
- `system.pc_info()` answers at once with the last measurement; when it is older than 30 minutes (`STALE_AFTER`) it starts one background refresh (one at a time) and the next call has the new data. Home asks `system.pc_info_fresh` (in the engine's own thread, never blocking the UI) at start if the saved copy is old, when it is shown again and every 10 minutes while open, and updates the header facts and the components only if something changed.
- Whatever Windows does not provide arrives as `null`: the UI shows "—" (`SH.tele.has`, `SH.tele.fmt`).
- Anything destructive always gets: a confirmation in the UI, `SH.requireAdmin` if needed, a restore point or a backup first, and undo whenever possible.
- Performance: no layout reads (`offsetLeft`, `getBoundingClientRect`) in per-frame loops; long lists use `content-visibility:auto` or virtualization, except a grid of cards (it lays the whole grid out again for every card that scrolls in or out: App Hangar's catalog is always rendered). A picture in a list has a fixed size in px, never a percentage (a lazy icon that loads as it scrolls in otherwise lays its list out again).
- Commands that run other programs (winget, installers) go through `updater._stream`, which ends when the command ends even if a process it started keeps the output pipe open (Foxit's update service did), and reports silence through `on_tick`.
- Start and exit: `stellarhub/splash.py` is the start screen (a Win32 layered window on its own thread). The main window is created off screen (WebView2 does not load a hidden window) and `Api._reveal` moves, maximizes and shows it when the UI calls `ui_ready`; `SH.enter()` / `SH.leave()` (core.js) fade the page in and out, and `Api.quit` waits for the fade. `STELLARHUB_NO_SPLASH=1` turns the start screen off.

- Start, handoffs and updates never leave the screen empty or silent (`app.py` main, `startup.py`, `instance.take_over_running_copy`, `engine/selfupdate.py`, `packaging/StellarHub.iss`):
  - The start screen is the first thing `main()` does (before waiting for a previous copy, elevating or claiming the lock). A copy started by the administrator relaunch or the task says "Opening as administrator…"; a second copy that finds the lock taken says "Opening StellarHub…".
  - A second copy asks the running one to show itself and needs its `ok` reply (1.5 s). No answer: it keeps trying for the lock for ~12 s, gives a copy that still has its start screen up its time (up to ~2 min: staged update), then ends the stuck copy and takes over; if it can't (an administrator copy), it says so in a message box. Never a silent exit.
  - `--wait-pid` waits at most 10 s for the previous copy and then ends it. The old copy keeps its own start screen up until the new copy's is visible (`splash.other_showing`).
  - Updates: the updater shows the start screen ("Installing the update…") from the moment the app closes, runs Setup with `/SILENT` (its small progress window, kept topmost; nothing to answer) and exits when that window is up; Setup opens StellarHub itself when it finishes (or the previous version if it failed). The portable `--finish-update` shows the start screen until the updated app has its own. The installer's last step runs `--warm` (loads every DLL once) so Windows' first-run scan of the new files happens inside the progress window, not at the first start.
  - `[phase]` lines in `stellarhub.log` time each step of a start from the process creation; the log rotates above 2 MB and repeated lines are counted.
  - Tests and isolated copies set `STELLARHUB_NO_DIALOGS=1` (implied by `STELLARHUB_ISOLATED=1` and `STELLARHUB_UPDATE_DIR`): messages go to the log, never a modal box. `STELLARHUB_LOCK_ID` lets isolated copies share one lock (single-instance tests).
- StellarHub's own updates: `engine/selfupdate.py` (how it works is in its docstring) and `ui/js/selfupdate.js` (the dialog). Tests serve a fake GitHub with `STELLARHUB_UPDATE_URL` and `STELLARHUB_UPDATE_DIR`; `STELLARHUB_ISOLATED=1` copies never elevate or touch the user's startup entries.
  - Signed releases (2.0.0+): the trust anchor is an Ed25519 signature (`stellarhub/ed25519.py`, pure Python, RFC 8032 vectors in `tests/`) over the manifest `StellarHub release
file: <name>
version: <X>
sha256: <hex>
`, checked against `TRUSTED_KEYS` in `selfupdate.py`; the `.sha256` files are only for humans. No `.sig` or a bad one: `pick()` returns nothing (check offers the release page, `unsigned: true`) or the updater fails with `why="signature"` and deletes the file. Rotating the key: add the new public key to `TRUSTED_KEYS`, release signed with the old key, drop the old one in a later release. Tests use throwaway keys and patch `TRUSTED_KEYS`; never put a real secret in the repo (`.gitignore` has `.stellarhub-release/` and `*.key`).
  - Release steps (owner's PC, once: `python tools/release_sign.py keygen --export`, keep the backup offline, paste the printed public key into `TRUSTED_KEYS`): 1. bump the version and push the tag so CI builds; 2. download the CI artifacts (`StellarHub-Setup-X.exe`, `StellarHub-Portable-X.zip`, and their `.sha256`); 3. sign locally: `python tools/release_sign.py sign StellarHub-Setup-X.exe StellarHub-Portable-X.zip --version X`; 4. optionally `verify` each; 5. publish the GitHub release with the four files plus the two `.sig` (six assets). A release without its `.sig` files is not installed by any copy.

## Testing

`index.html#drivers/all` opens a tab; `index.html#drivers/*` walks through all of them; `index.html#home=xray` forces a Home view. Script: `check_ui.sh "index.html#drivers/*"` (headless Edge, lists JS errors).

## Writing

English only. Sentence case (capitalize only the first word and proper names), clear verbs ("Uninstall" → "Uninstalled"). No ALL-CAPS labels, no filler "A · B · C", no "→" on buttons, no emojis, no purple gradients. Numbers and dates use the `en-US` locale.

## Text and translations

Every sentence the user reads is written in English and wrapped: `SH.t('Scan the disk')`, or with placeholders
`SH.t('{n} files', { n })`. Static text in HTML files uses `data-t` (text) and `data-t-attr="title aria-label"`
(attributes). Engine code that produces visible text uses `tr()` from `stellarhub/i18n.py`. The dictionaries, the
rules and the glossary are in [`stellarhub/ui/i18n/`](../stellarhub/ui/i18n/README.md). Never compare displayed text
in code, and format numbers with `SH.fmt1` / `SH.fmtInt`, which follow the interface language.
