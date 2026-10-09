# Sanitizes an unDraw SVG for the app: only drawing elements and attributes, no scripts/events/external links;
# the illustration's accent (#6c63ff) becomes the app's teal. Usage: clean_svg.py IN OUT
import re, sys, xml.etree.ElementTree as ET
NS = 'http://www.w3.org/2000/svg'
ALLOWED = {'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title'}
ATTRS = {'viewBox', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity',
         'transform', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
         'clip-path', 'fill-rule', 'clip-rule', 'isolation', 'style'}
ET.register_namespace('', NS)
src, dst = sys.argv[1], sys.argv[2]
root = ET.parse(src).getroot()
def tag(e): return e.tag.split('}')[-1]
def clean(e):
    for c in list(e):
        if tag(c) not in ALLOWED: e.remove(c); continue
        clean(c)
    for k in list(e.attrib):
        name = k.split('}')[-1]
        v = e.attrib[k]
        if name not in ATTRS or 'url(' in v and not re.fullmatch(r"url\(#[\w-]+\)", v.strip()) or (name == 'style' and re.search(r'url\(|expression|@import', v)):
            del e.attrib[k]
assert tag(root) == 'svg'
clean(root)
for k in ('width', 'height'): root.attrib.pop(k, None)
root.set('role', 'img'); root.set('aria-hidden', 'true')
out = ET.tostring(root, encoding='unicode')
out = re.sub(r'#6c63ff', '#0d7377', out, flags=re.I)
out = re.sub(r'>\s+<', '><', out)
open(dst, 'w').write(out)
print(dst, len(out))
