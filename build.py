#!/usr/bin/env python3
"""Sestaví celou hru do jediného souboru kolonie.html (CSS i JS vložené přímo)."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
def inline(m):
    js = (root / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>\n// ===== ' + m.group(1) + ' =====\n' + js + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
(root / 'kolonie.html').write_text(html, encoding='utf-8')
print('kolonie.html', len(html.encode('utf-8')), 'B')
