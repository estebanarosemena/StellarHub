# StellarHub: product context

## What it is
The control center for a Windows PC: live hardware stats, drivers, program updates and removal, disk space, cleanup
and repair, privacy, benchmarks, device tests and automatic maintenance, in one desktop app (Python + pywebview /
WebView2, one plain HTML/CSS/JS interface). Everything works on real data, and everything that changes the system is
confirmed first and reversible whenever possible.

## Users
- **Home PC owners and gamers** on Windows 10/11 laptops and desktops (including handhelds such as the ROG Ally, used
  with a controller). They want their PC healthy and up to date without six separate tools.
- **Tinkerers** who open it often, read the numbers and want depth (per-thread CPU, SMART, services, startup items).
- Languages: English, Russian, Spanish, Portuguese, Italian, French, Chinese and Japanese.

## Surfaces and modes
- Home (Mosaic and 3D views): **Experience**, a first glance at the machine, then a way in.
- The 12 modules, Settings, palette, dialogs, toasts, widget and tray panel: **Operate**.
- Start screen (Pillow, `stellarhub/splash.py`) and boot overlay: brand moment, seconds long.

## Brand commitments (pinned by the owner)
- Space, galaxy, stellar: the animated starfield, the deep-space palette and the nebula wash stay.
- Coral `#FF7A66` and ice `#9ED6FF` are the accents (users can pick other presets; the system follows `--accent`).
- The planet-with-orbit mark is the identity; depth and a cinematic feel stay.
- Unbounded (display) + Onest (text), both bundled.

## Constraints
- Must stay fast on integrated GPUs and on battery: `html[data-lite]`, `SH.effInt()`, intensity `min` stops loops,
  no new backdrop-filter on large areas, no new per-frame loops.
- Every visible string goes through `SH.t()` and is translated into es, pt, it, fr, zh.
- Writing: sentence case, no ALL-CAPS labels, no emojis in the UI, no purple gradients.
- Layouts are designed for 1100 x 700 CSS px and must not wrap badly or overlap there. Smaller windows (handhelds at
  150 %, a small window) switch to the compact layout: the page scrolls, nothing is clipped or left under the dock.
