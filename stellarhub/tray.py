"""StellarHub icon in the system tray (pystray), with its menu. make_icon_image() is also the app icon:
packaging/make_assets.py builds the .ico and the installer artwork from it (stellarhub/ui/img/logo.svg is the
same drawing as an SVG)."""
import math
import random
import threading

from PIL import Image, ImageChops, ImageDraw, ImageFilter

_CORAL = (255, 122, 102)
_ICE = (158, 214, 255)


def _field(w, h, fn, res=96):
    """a smooth RGBA field: fn(u, v) -> (r, g, b, a) evaluated on a small grid, then scaled up"""
    gw, gh = res, max(2, round(res * h / w))
    small = Image.new("RGBA", (gw, gh))
    small.putdata([fn((x + .5) / gw, (y + .5) / gh) for y in range(gh) for x in range(gw)])
    return small.resize((w, h), Image.BICUBIC)


def _mix(a, b, t):
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _layer(s, color, mask):
    im = Image.new("RGBA", (s, s), color + (0,))
    im.putalpha(mask)
    return im


def make_icon_image(size=64, tile=True):
    """The StellarHub icon: a lit coral planet inside an ice-blue ring that passes behind and in front of it,
    with a small moon, on a deep-space navy tile. Small sizes (taskbar, tray) use a simplified, pixel-aligned
    drawing; from 48 px up it gets the shading, the ring's shadow and a few stars.
    tile=False draws only the planet, ring and moon (the installer artwork puts them on its own sky)."""
    tier = 0 if size <= 20 else 1 if size <= 40 else 2
    k = 16 if size <= 40 else 8 if size <= 128 else max(2, min(4, 2400 // size))  # drawn large, then scaled down
    s = size * k
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # --- the tile
    inset = (0, .03, .04)[tier] * s
    radius = (.22, .22, .225)[tier] * s
    box = (inset, inset, s - inset - 1, s - inset - 1)
    clip = Image.new("L", (s, s), 0)
    ImageDraw.Draw(clip).rounded_rectangle(box, radius=radius, fill=255)
    if tile:
        top, bottom = (27, 42, 78), (7, 11, 22)
        warm = (58, 30, 44)

        def bg(u, v):
            c = _mix(top, bottom, v ** .85)
            # a warm glow behind the planet, a cool one near the moon
            d = math.hypot(u - .48, v - .6) / .5
            c = _mix(c, warm, (1 - d) * .55 if d < 1 else 0)
            d2 = math.hypot(u - .82, v - .12) / .45
            c = _mix(c, (30, 52, 84), (1 - d2) * .5 if d2 < 1 else 0)
            return c + (255,)
        space = _field(s, s, bg, res=48)
        if tier == 2:  # a few faint stars
            rnd = random.Random(11)
            sd = ImageDraw.Draw(space)
            for _ in range(18):
                x, y = rnd.uniform(.1, .9) * s, rnd.uniform(.08, .92) * s
                if math.hypot(x / s - .5, y / s - .53) < .3:
                    continue
                r = s * rnd.choice((.0045, .0045, .006, .008))
                sd.ellipse((x - r, y - r, x + r, y + r),
                           fill=_mix((40, 60, 100), (230, 242, 255), rnd.uniform(.4, 1)) + (255,))
        img.paste(space, (0, 0), clip)
        # rim light along the top edge
        rim = Image.new("L", (s, s), 0)
        ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=255,
                                              width=max(1, round(s * (.012, .01, .007)[tier])))
        fade = Image.linear_gradient("L").resize((s, s)).point(
            lambda v: int((70, 90, 120)[tier] * max(0, 1 - v / 160) ** 1.5))
        img.alpha_composite(_layer(s, (200, 228, 255), ImageChops.multiply(rim, fade)))

    # --- geometry (fractions of the canvas)
    cx, cy = .5 * s, (.53, .53, .53)[tier] * s
    pr = (.25, .225, .2)[tier] * s
    rx, ry = (.42, .41, .385)[tier] * s, (.15, .145, .135)[tier] * s
    rw = (.1, .08, .064)[tier] * s
    tilt = 16 if tier == 0 else 20
    if tier == 0:  # pixel-align the planet: integer diameter, centered on the grid
        px = size / 16
        cx, cy = 8 * px * k, 8 * px * k
        pr = 4 * px * k

    # ring: the half above the center passes behind the planet, the other half in front
    ring = Image.new("L", (s, s), 0)
    ImageDraw.Draw(ring).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=255, width=round(rw))
    upper = Image.new("L", (s, s), 0)
    ImageDraw.Draw(upper).rectangle((0, 0, s, cy), fill=255)
    ring = ring.rotate(tilt, resample=Image.BICUBIC, center=(cx, cy))
    upper = upper.rotate(tilt, resample=Image.NEAREST, center=(cx, cy))
    big = size >= 200  # the start screen: no hard seam where the two halves meet, softer shadows
    if big:
        upper = upper.filter(ImageFilter.GaussianBlur(s * .035))

    def hint(m):
        """small sizes: snap each shape's edge pixels toward fully on or off, so lines stay crisp"""
        if tier == 2:
            return m
        lo, hi = (45, 175) if tier == 0 else (35, 220)
        return m.resize((size, size), Image.BOX).point(
            lambda v: 0 if v < lo else 255 if v > hi else int((v - lo) * 255 / (hi - lo))).resize((s, s), Image.NEAREST)
    ring = hint(ring)
    back = ImageChops.multiply(ring, upper)
    front = ImageChops.subtract(ring, back)
    if tier:  # the same ring a little wider on both sides: cuts a sliver of space into the planet (see below)
        g = s * .011
        wide = Image.new("L", (s, s), 0)
        ImageDraw.Draw(wide).ellipse((cx - rx - g, cy - ry - g, cx + rx + g, cy + ry + g), outline=255,
                                     width=round(rw + 2 * g))
        wide = wide.rotate(tilt, resample=Image.BICUBIC, center=(cx, cy))
        wide = ImageChops.subtract(hint(wide), upper)

    def ring_color(dim):
        def f(u, v):
            c = _mix((226, 244, 255), _ICE, u * 1.3) if not dim else _mix((150, 200, 240), (104, 158, 214), u)
            return c + (255,)
        return _field(s, s, f, res=24)
    b = ring_color(True) if tier else _layer(s, (120, 176, 230), back)
    b.putalpha(back)
    img.alpha_composite(b)

    # planet: lit from the upper left, darker toward the lower right, a soft terminator
    disc = Image.new("L", (s, s), 0)
    ImageDraw.Draw(disc).ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=255)
    disc = hint(disc)
    lx, ly = (cx - pr * .45) / s, (cy - pr * .5) / s
    pn = pr / s

    def sphere(u, v):
        d = math.hypot(u - lx, v - ly) / (pn * 1.9)
        if tier == 0:
            return _mix((255, 150, 128), (232, 98, 82), d) + (255,)
        c = _mix((255, 186, 166), _CORAL, d * 1.5)
        c = _mix(c, (178, 56, 62), (d - .55) * 2.1)
        return c + (255,)
    pl = _field(s, s, sphere, res=64)
    pl.putalpha(disc)
    img.alpha_composite(pl)
    if tier == 2:
        # the ring's shadow falls on the planet just above where it passes in front
        sh = front.transform((s, s), Image.AFFINE, (1, 0, 0, 0, 1, s * .028)).filter(ImageFilter.GaussianBlur(s * (.022 if big else .008)))
        sh = ImageChops.multiply(sh, disc).point(lambda v: int(v * (.36 if big else .5)))
        img.alpha_composite(_layer(s, (90, 16, 34), sh))
        # a thin atmospheric rim on the lit edge
        edge = Image.new("L", (s, s), 0)
        ImageDraw.Draw(edge).ellipse((cx - pr, cy - pr, cx + pr, cy + pr), outline=255, width=round(s * .008))
        lit = _field(s, s, lambda u, v: (0, 0, 0, max(0, min(255, int(255 * (1 - (u + v - .55) * 2.2))))),
                     res=32).getchannel("A")
        img.alpha_composite(_layer(s, (255, 214, 200), ImageChops.multiply(edge, lit).point(lambda v: int(v * .7))))

    # a sliver of navy between the planet and the front of the ring, so the ring clearly passes in front
    if tier:
        gap = ImageChops.multiply(ImageChops.subtract(wide, front), disc).point(lambda v: int(v * (.45 if big else .85)))
        if big:
            gap = gap.filter(ImageFilter.GaussianBlur(s * .004))
        img.alpha_composite(_layer(s, (24, 20, 40), gap))
    f = ring_color(False) if tier else _layer(s, (196, 234, 255), front)
    f.putalpha(front)
    img.alpha_composite(f)

    # the moon, with a faint glow at large sizes (at tray size there is no room for it next to the ring)
    if tier:
        mx, my, mr = (0, .785, .775)[tier] * s, (0, .185, .2)[tier] * s, (0, .065, .048)[tier] * s
        if tier == 2 and not big:  # (large: the start screen draws it on its own, wider canvas)
            glow = Image.new("L", (s, s), 0)
            ImageDraw.Draw(glow).ellipse((mx - mr * 2.6, my - mr * 2.6, mx + mr * 2.6, my + mr * 2.6), fill=70)
            img.alpha_composite(_layer(s, _ICE, glow.filter(ImageFilter.GaussianBlur(mr * 1.2))))
        moon = Image.new("L", (s, s), 0)
        ImageDraw.Draw(moon).ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=255)
        img.alpha_composite(_layer(s, (226, 242, 255), hint(moon)))

    if tile:
        img.putalpha(ImageChops.multiply(img.getchannel("A"), clip))
    return img.resize((size, size), Image.LANCZOS if k <= 8 else Image.BOX)


ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def save_ico(path, sizes=ICON_SIZES):
    """An .ico with every size drawn on its own (the small ones are hand-tuned), not scaled down from one image."""
    sizes = sorted(sizes)
    frames = [make_icon_image(s) for s in sizes]
    frames[-1].save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1],
                    bitmap_format="png")


def _crisp_icon_class(base):
    """pystray loads its icon at the large icon size (32 px at 100 %) and Windows shrinks it for the tray, which blurs
    the small drawing. This loads the hand-tuned frame for the tray's own size instead; any failure falls back."""
    class CrispIcon(base):
        def _assert_icon_handle(self):
            if self._icon_handle:
                return
            try:
                import ctypes
                import os
                import tempfile
                u32 = ctypes.WinDLL("user32")  # own instance: pystray sets its own prototypes on the shared one
                load = u32.LoadImageW
                load.restype = ctypes.c_void_p
                load.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_int, ctypes.c_int,
                                 ctypes.c_uint)
                px = u32.GetSystemMetrics(49) or 16  # SM_CXSMICON: the tray's icon size at this scaling
                fd, path = tempfile.mkstemp(suffix=".ico")
                os.close(fd)
                try:
                    save_ico(path, {16, 20, 24, 32, 40, 48, px})
                    h = load(None, path, 1, px, px, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
                finally:
                    os.remove(path)
                if h:
                    self._icon_handle = h
                    return
            except Exception:
                pass
            super()._assert_icon_handle()

        def _on_notify(self, wparam, lparam):
            """A click on the notification balloon (NIN_BALLOONUSERCLICK) runs what the last notify() asked for (open
            the window on the module that finished); everything else is pystray's own handling."""
            if lparam == 0x405:
                run = getattr(self, "_sh_click", None)
                if run is not None:
                    threading.Thread(target=run, daemon=True, name="tray-notify-click").start()
                return
            super()._on_notify(wparam, lparam)
    return CrispIcon


_ICON = None


def icon_image():
    """make_icon_image() at tray size, drawn once (the start prefetches it)."""
    global _ICON
    if _ICON is None:
        _ICON = make_icon_image()
    return _ICON


class Tray:
    def __init__(self, api):
        self.api = api
        self.icon = None

    def start(self):
        import pystray
        from pystray import Menu, MenuItem as Item

        a = self.api
        from .i18n import tr

        def L(text):
            return lambda item: tr(text)

        def go(mod, tab=None):
            def run(icon, item):
                a.show_main()
                t = f", {{tab: '{tab}'}}" if tab else ""
                a._js(f"SH.go('{mod}'{t})")
            return run

        # texts are functions: pystray asks for them each time the menu opens, so they follow the language
        menu = Menu(
            # left click: StellarHub's own panel; the right click shows this native menu
            Item("panel", lambda i, it: a.tray_panel_toggle(), default=True, visible=False),
            Item(L("Open StellarHub"), lambda i, it: a.show_main()),
            Item(L("Always-on-top widget"), lambda i, it: a.widget_toggle(), checked=lambda it: a._widget is not None),
            Menu.SEPARATOR,
            Item(L("Live Monitor"), go("monitor")),
            Item(L("Optimize everything"), go("optimizer", "overview")),
            Item(L("Check for updates"), go("updater", "overview")),
            Item(L("Analyze the disk"), go("storage", "map")),
            Menu.SEPARATOR,
            Item(L("Turn on administrator mode"), lambda i, it: self.to_admin(), visible=lambda it: not a.info()["admin"]),
            Item(L("Settings"), lambda i, it: (a.show_main(), a._js("SH.go('settings')"))),
            Menu.SEPARATOR,
            # its own thread: quit() may ask "still running, quit anyway?" in a message box, and a box opened inside
            # the menu's handler on the tray thread took no clicks, and froze this menu until it was answered
            Item(L("Quit StellarHub"), lambda i, it: threading.Thread(target=a.quit, name="tray-quit").start()),
        )
        self.icon = _crisp_icon_class(pystray.Icon)("StellarHub", icon_image(), "StellarHub", menu)
        threading.Thread(target=self.icon.run, daemon=True, name="tray").start()

    def to_admin(self):
        """The menu's "Turn on administrator mode". While something the user started still runs here, nothing is asked
        (relaunch_admin answers "busy") and the menu said nothing at all: now a notification says why."""
        if self.api.relaunch_admin() == "busy":
            from .i18n import tr
            self.notify(tr("Something you started is still running. Open as administrator when it finishes."))

    def notify(self, text, title="StellarHub", on_click=None):
        """on_click: what a click on this notification does (it replaces the previous one's; None: nothing)."""
        try:
            if self.icon is not None:
                self.icon._sh_click = on_click
                self.icon.notify(text, title)
        except Exception:
            pass

    def rebuild(self):
        """After a language change: the item texts are re-read when the menu is redrawn."""
        self.refresh()

    def refresh(self):
        try:
            self.icon and self.icon.update_menu()
        except Exception:
            pass

    def stop(self):
        try:
            self.icon and self.icon.stop()
        except Exception:
            pass
