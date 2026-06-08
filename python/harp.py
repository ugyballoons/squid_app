"""Music-theory helpers for the set-list app.

The core feature is deriving the *cross-harp* (second-position) key from a
song's key. In cross harp the song key is the perfect 5th of the harmonica,
i.e. the harp is a **perfect fourth above** the song key:

    Song C -> F harp,  G -> C,  A -> D,  E -> A, ...

This holds for both major and minor songs (the interval is the same; we just
keep the major/minor quality on the resulting label).
"""

from __future__ import annotations

# Chromatic scale using sharps. We normalise flats onto these before working.
_SHARP_SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Map any reasonable spelling of a pitch onto an index in _SHARP_SCALE.
_FLAT_TO_SHARP = {
    "DB": "C#",
    "EB": "D#",
    "GB": "F#",
    "AB": "G#",
    "BB": "A#",
    # enharmonic oddities people sometimes type
    "CB": "B",
    "FB": "E",
    "E#": "F",
    "B#": "C",
}

# For nicer display, a few harp keys are conventionally written as flats.
_PREFER_FLAT = {"A#": "Bb", "D#": "Eb", "G#": "Ab"}


def _parse_key(key: str | None):
    """Split a key string into (pitch_index, quality_suffix).

    Returns (index_into_sharp_scale, suffix) or (None, "") if unparseable.
    `suffix` is the text after the pitch, e.g. "m", " minor", "maj7" — we
    keep it so the harp key carries the same quality.
    """
    if not key:
        return None, ""
    raw = key.strip()
    if not raw:
        return None, ""

    # Pitch is the first 1-2 chars: a letter A-G optionally followed by # or b.
    letter = raw[0].upper()
    if letter not in "ABCDEFG":
        return None, ""

    pitch = letter
    rest = raw[1:]
    if rest[:1] in ("#", "b", "B") and rest[:1] != "" and rest[:2].upper() not in ("MA",):
        # Treat a following # or b as part of the pitch (but not the 'b' in a
        # word like "Bm"? there is none). Lowercase b -> flat.
        accidental = rest[0]
        if accidental in ("#", "b"):
            pitch = letter + ("#" if accidental == "#" else "b")
            rest = rest[1:]

    suffix = rest  # whatever's left: "", "m", "min", " minor", "7", ...

    norm = pitch.upper()
    if norm in _FLAT_TO_SHARP:
        norm = _FLAT_TO_SHARP[norm]
    if norm.endswith("B") and len(norm) == 2:  # e.g. "DB" already handled, guard
        norm = _FLAT_TO_SHARP.get(norm, norm)

    if norm not in _SHARP_SCALE:
        return None, ""
    return _SHARP_SCALE.index(norm), suffix


def is_minor(key: str | None) -> bool:
    """True if the key looks minor (e.g. 'Am', 'A minor', 'Bbmin')."""
    _, suffix = _parse_key(key)
    s = suffix.strip().lower()
    return s.startswith("m") and not s.startswith("maj")


def _display_pitch(index: int) -> str:
    name = _SHARP_SCALE[index]
    return _PREFER_FLAT.get(name, name)


def cross_harp_key(key: str | None) -> str | None:
    """Return the cross-harp key (a perfect 4th above the song key).

    Preserves minor/quality suffix. Returns None if the key can't be parsed
    (e.g. the song has no key set yet).
    """
    index, suffix = _parse_key(key)
    if index is None:
        return None
    harp_index = (index + 5) % 12  # perfect fourth = 5 semitones
    label = _display_pitch(harp_index)
    return label + suffix
