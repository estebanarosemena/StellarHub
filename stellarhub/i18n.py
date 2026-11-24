"""Translations for text produced in Python (engine progress, errors, explanations, the tray menu).

Same dictionaries as the interface: stellarhub/ui/i18n/<lang>/<area>.json, {"English text": "translation"}.
Usage, anywhere in the engine:

    from ..i18n import tr
    job.progress(.4, tr("Reading the drivers…"))
    raise RuntimeError(tr("{name} could not be removed.", name=p["name"]))

The language is the "language" setting ("auto" or missing = the Windows display language). app.py calls
set_language() at start and whenever the setting changes."""
import ctypes
import json
import os
import sys
import threading

CODES = ("en", "es", "pt", "it", "fr", "zh", "ja", "ru")
_lock = threading.Lock()
_lang = None
_dict = {}


def _ui_dir():
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, "stellarhub", "ui", "i18n")


def build_bundles(i18n_dir=None):
    """One file per language with every area merged (ui/i18n/_bundle/<lang>.json), so the page reads its dictionary
    with ONE request at start instead of twenty (each synchronous request cost ~5 ms: 100 ms of a blank window).
    Merged in the order i18n.js lists the areas. Only stale or missing bundles are rewritten; the page falls back
    to the single files when a bundle is absent. Returns how many were written."""
    base = i18n_dir or _ui_dir()
    areas = []
    try:
        with open(os.path.join(os.path.dirname(base), "js", "i18n.js"), encoding="utf-8") as fh:
            import re
            m = re.search(r"const AREAS = \[(.*?)\];", fh.read(), re.S)
            areas = re.findall(r"'([\w-]+)'", m.group(1)) if m else []
    except OSError:
        pass
    written = 0
    for lang in CODES:
        folder = os.path.join(base, lang)
        if lang == "en" or not os.path.isdir(folder):
            continue
        names = [a + ".json" for a in areas if os.path.isfile(os.path.join(folder, a + ".json"))]
        out = os.path.join(base, "_bundle", lang + ".json")
        try:
            newest = max([os.path.getmtime(os.path.join(folder, n)) for n in names] + [os.path.getmtime(os.path.join(os.path.dirname(base), "js", "i18n.js"))])
            if os.path.isfile(out) and os.path.getmtime(out) >= newest:
                continue
            merged = {}
            for n in names:
                with open(os.path.join(folder, n), encoding="utf-8") as fh:
                    merged.update(json.load(fh))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            tmp = out + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(merged, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, out)
            written += 1
        except (OSError, ValueError):
            pass  # no bundle: the page reads the single files
    return written


def windows_language():
    """Two-letter code of the Windows display language, if StellarHub has it; otherwise English."""
    try:
        buf = ctypes.create_unicode_buffer(85)
        lcid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        if ctypes.windll.kernel32.LCIDToLocaleName(lcid, buf, 85, 0):
            code = buf.value.split("-")[0].lower()
            return code if code in CODES else "en"
    except Exception:
        pass
    return "en"


def resolve(pref):
    return pref if pref in CODES else windows_language()


def set_language(pref):
    """pref: a code from CODES, or "auto"/None for the Windows language."""
    global _lang, _dict
    lang = resolve(pref)
    with _lock:
        if lang == _lang:
            return lang
        merged = {}
        folder = os.path.join(_ui_dir(), lang)
        if lang != "en" and os.path.isdir(folder):
            for name in sorted(os.listdir(folder)):
                if name.endswith(".json"):
                    try:
                        with open(os.path.join(folder, name), encoding="utf-8") as fh:
                            merged.update(json.load(fh))
                    except (OSError, ValueError):
                        pass  # a broken file only leaves its area in English
        _lang, _dict = lang, merged
    return lang


def language():
    if _lang is None:
        _init_from_settings()
    return _lang


def _init_from_settings():
    if os.environ.get("STELLARHUB_LANG"):  # tests and diagnostics pin it
        set_language(os.environ["STELLARHUB_LANG"])
        return
    from . import paths
    path = paths.settings_file()
    try:
        with open(path, encoding="utf-8") as fh:
            pref = json.load(fh).get("language")
    except (OSError, ValueError, AttributeError):  # (AttributeError: a settings file that is not an object)
        pref = None
    set_language(pref)


def tr(text, **kw):
    """The translation of an English sentence; {name} placeholders are filled from the keyword arguments.
    Unknown text comes back in English, so a missing translation never breaks anything."""
    if _lang is None:
        _init_from_settings()
    s = _dict.get(text) or text
    if kw:
        try:
            s = s.format(**kw)
        except (KeyError, IndexError, ValueError):
            s = text.format(**kw)
    return s


def tc(context, text, **kw):
    """Like tr(), for words whose meaning depends on where they are: looks up "context|text" first."""
    if _lang is None:
        _init_from_settings()
    key = f"{context}|{text}"
    if _dict.get(key):
        s = _dict[key]
        try:
            return s.format(**kw) if kw else s
        except (KeyError, IndexError, ValueError):
            return text.format(**kw) if kw else text
    return tr(text, **kw)
