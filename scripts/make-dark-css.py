#!/usr/bin/env python3
"""Generate src/dark.css from src/style.css.

Every rule in style.css that sets a colour is repeated under :root[data-theme="dark"]
with the colours turned into their dark-mode equivalents:
  - light backgrounds become dark surfaces (white cards slightly lighter than the page)
  - dark text becomes light text; light text (on green buttons) is left alone
  - rules on dark or brand-coloured backgrounds (green buttons, toasts) keep their colours
  - receipts keep their paper look, and print styles are skipped
Rules are repeated in the same order with the same extra specificity, so the cascade
behaves exactly as in light mode.

Run after changing colours in style.css:   python3 scripts/make-dark-css.py
(needs: pip install tinycss2)
"""
import colorsys, re, sys
from pathlib import Path
import tinycss2

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'src/style.css', ROOT / 'src/dark.css'
PREFIX = ':root[data-theme="dark"]'
KEEP_LIGHT = re.compile(r'\.receipt-(?!modal|backdrop|actions)|\.print-only|\.invoice-paper|\.doc-paper')

HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b')
RGBA = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)')
NAMED = {'white': (255, 255, 255, 1.0), 'black': (0, 0, 0, 1.0)}
NAMED_RE = re.compile(r'(?<![\w-])(white|black)(?![\w-])')

TEXT = {'color', 'caret-color', '-webkit-text-fill-color', 'fill', 'stroke', 'text-decoration-color'}
BACK = {'background', 'background-color', 'background-image'}
LINE = {'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-top-color',
        'border-right-color', 'border-bottom-color', 'border-left-color', 'outline', 'outline-color', 'column-rule', 'border-block-end', 'border-inline-start'}


def parse_hex(h):
    h = h.lstrip('#')
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def to_hex(r, g, b, a):
    s = '#%02x%02x%02x' % (round(r), round(g), round(b))
    return s + ('%02x' % round(a * 255) if a < 0.999 else '')


def hls(c):
    r, g, b, a = c
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h, l, s, a


def from_hls(h, l, s, a):
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s)))
    return to_hex(r * 255, g * 255, b * 255, a)


def map_bg(c):
    h, l, s, a = hls(c)
    if l < 0.6: return None                          # already dark / brand colour: keep
    if a < 0.35: return None                         # see-through overlays: keep
    if l >= 0.985: return from_hls(0.43, 0.155, 0.12, a)        # white cards (a hint of the brand green)
    return from_hls(h if s > 0.02 else 0.43, 0.10 + (0.985 - l) * 0.55, s * 0.55 if s > 0.02 else 0.1, a)  # page and tinted surfaces


def map_text(c):
    h, l, s, a = hls(c)
    if l > 0.8 or a < 0.35: return None              # light text sits on a dark/brand surface: keep
    return from_hls(h, 0.95 - l * 0.75, min(1, s * 1.05), a)


def map_line(c):
    h, l, s, a = hls(c)
    if l < 0.6 or a < 0.35: return None              # brand / dark lines, see-through lines: keep
    return from_hls(h if s > 0.02 else 0.43, 0.17 + (1 - l) * 0.8, s * 0.5 if s > 0.02 else 0.08, a)


def colours(value):
    """Yield (span, rgba) for every colour in a CSS value."""
    for m in HEX.finditer(value): yield m.span(), parse_hex(m.group(0))
    for m in RGBA.finditer(value): yield m.span(), (int(m[1]), int(m[2]), int(m[3]), float(m[4]) if m[4] else 1.0)
    for m in NAMED_RE.finditer(value): yield m.span(), NAMED[m[1]]


def remap(value, fn):
    out, last, changed = [], 0, False
    for (a, b), c in sorted(colours(value)):
        new = fn(c)
        out.append(value[last:a]); out.append(new if new else value[a:b]); last = b
        changed |= bool(new)
    out.append(value[last:])
    return ''.join(out), changed


def bg_lightness(decls):
    for name, value in decls:
        if name in BACK:
            cs = list(colours(value))
            if cs: return min(hls(c)[1] for _, c in cs)
    return None


def split_decls(text):
    decls = []
    for d in tinycss2.parse_declaration_list(text, skip_comments=True, skip_whitespace=True):
        if d.type == 'declaration':
            decls.append((d.lower_name, tinycss2.serialize(d.value).strip() + (' !important' if d.important else '')))
    return decls


def prefix(selector):
    parts = []
    for sel in selector.split(','):
        sel = sel.strip()
        if not sel: continue
        if sel.startswith(':root'): parts.append(PREFIX + sel[5:])
        elif re.match(r'html(?![\w-])', sel): parts.append(PREFIX + sel[4:])
        else: parts.append(PREFIX + ' ' + sel)
    return ','.join(parts)


def convert_rule(rule):
    selector = tinycss2.serialize(rule.prelude).strip()
    if KEEP_LIGHT.search(selector): return None
    decls = [(n, v) for n, v in split_decls(tinycss2.serialize(rule.content)) if n in TEXT | BACK | LINE or n == 'box-shadow']
    # Keep colour-less resets too (transparent / none / 0) so they still win over the repeated base rules.
    reset = re.compile(r'(?<![\w-])(transparent|none|inherit|currentcolor|unset|initial|0)(?![\w-])', re.I)
    decls = [(n, v) for n, v in decls if any(True for _ in colours(v)) or (n in BACK | LINE | TEXT and reset.search(v))]
    if not decls: return None
    bg = bg_lightness(decls)
    keep_all = bg is not None and bg < 0.6           # dark or brand background: same colours, repeated for the cascade
    out = []
    for n, v in decls:
        if keep_all or n == 'box-shadow': out.append((n, v)); continue
        fn = map_bg if n in BACK else map_text if n in TEXT else map_line
        nv, _ = remap(v, fn)
        out.append((n, nv))
    return prefix(selector) + '{' + ';'.join(f'{n}:{v}' for n, v in out) + '}'


def walk(rules, depth=0):
    out = []
    for r in rules:
        if r.type == 'qualified-rule':
            c = convert_rule(r)
            if c: out.append(c)
        elif r.type == 'at-rule' and r.lower_at_keyword == 'media':
            cond = tinycss2.serialize(r.prelude).strip()
            if 'print' in cond: continue
            inner = walk(tinycss2.parse_rule_list(r.content, skip_comments=True, skip_whitespace=True), depth + 1)
            if inner: out.append(f'@media {cond}{{' + ''.join(inner) + '}')
    return out


BASE = f'''/* Generated by scripts/make-dark-css.py from style.css — do not edit by hand. */
{PREFIX}{{color-scheme:dark}}
@media screen{{
{PREFIX},{PREFIX} body{{background:#121a16;color:#dbe5df}}
{PREFIX} input,{PREFIX} select,{PREFIX} textarea{{color:#e3ece7}}
{PREFIX} select option{{background:#1a2420;color:#e3ece7}}
{PREFIX} input::placeholder,{PREFIX} textarea::placeholder{{color:#7f8f87}}
{PREFIX} img{{opacity:.96}}
{PREFIX} ::selection{{background:#2e6b52;color:#fff}}
'''


def main():
    sheet = tinycss2.parse_stylesheet(SRC.read_text(), skip_comments=True, skip_whitespace=True)
    rules = walk(sheet)
    OUT.write_text(BASE + '\n'.join(rules) + '\n}\n')
    print(f'{OUT.relative_to(ROOT)}: {len(rules)} rules')


if __name__ == '__main__':
    sys.exit(main())
