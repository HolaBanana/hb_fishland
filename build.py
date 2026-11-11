#!/usr/bin/env python3
"""Sestaví celou hru do jediného souboru kolonie.html.

CSS, všechny skripty i písmo VT323 (base64) se vloží přímo do stránky, takže
výsledek nemá žádnou vnější závislost a jde otevřít dvojklikem.

Použití:
    python3 build.py              # zapíše kolonie.html vedle zdrojáků
    python3 build.py --site DIR   # navíc zapíše DIR/index.html (pro GitHub Pages)
"""
import base64, pathlib, re, sys

root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')


def font(m):
    data = (root / 'css' / m.group(1)).resolve().read_bytes()
    return 'url(data:font/woff2;base64,' + base64.b64encode(data).decode('ascii') + ')'


css = re.sub(r'url\(([^)]+\.woff2)\)', font, css)
html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')


def inline(m):
    js = (root / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>\n// ===== ' + m.group(1) + ' =====\n' + js + '\n</script>'


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
leftover = sorted(set(re.findall(r'https?://[^\s"\'`)<]+', html)))
if leftover:
    sys.exit('Ve výsledku zůstaly vnější adresy: ' + ', '.join(leftover))

(root / 'kolonie.html').write_text(html, encoding='utf-8')
print('kolonie.html', len(html.encode('utf-8')), 'B')
if '--site' in sys.argv:
    site = pathlib.Path(sys.argv[sys.argv.index('--site') + 1])
    site.mkdir(parents=True, exist_ok=True)
    (site / 'index.html').write_text(html, encoding='utf-8')
    print(site / 'index.html')
