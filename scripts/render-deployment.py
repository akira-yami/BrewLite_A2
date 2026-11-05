"""Render the fixed UML layout in deployment-production.drawio to SVG and PNG.

Source of truth: editable Draw.io XML (node geometry, labels, edge waypoints).
Requires Python 3 and Pillow. Supports only the styles used by this diagram;
unsupported styles fail instead of producing an incorrect export silently.
"""
from pathlib import Path
import html
import os
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/diagrams/deployment-production.drawio'
STEM = SOURCE.with_suffix('')
SCALE = 2
W, H = 1740, 1220
im = Image.new('RGB', (W * SCALE, H * SCALE), 'white')
draw = ImageDraw.Draw(im)
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
       '<title>BrewLite — Deployment of Components / Railway</title>',
       '<desc>UML deployment diagram. Production source BrewLite_A1, snapshot 04 November 2026. Local and CI boundaries shown separately.</desc>',
       '<rect width="100%" height="100%" fill="white"/>']
fonts = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'


def font(bold=False, size=14):
    return ImageFont.truetype(str(fonts / ('arialbd.ttf' if bold else 'arial.ttf')), size * SCALE)


def polygon(points, fill='white'):
    svg.append(f'<polygon points="{" ".join(f"{x},{y}" for x,y in points)}" fill="{fill}" stroke="#222" stroke-width="1"/>')
    draw.polygon([(int(x*SCALE), int(y*SCALE)) for x,y in points], fill=fill, outline='#222', width=SCALE)


def line(points, dashed=False):
    svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" fill="none" stroke="#222" stroke-width="1"'+(' stroke-dasharray="5 4"' if dashed else '')+'/>')
    for (x,y),(a,b) in zip(points, points[1:]):
        if not dashed:
            draw.line((x*SCALE,y*SCALE,a*SCALE,b*SCALE), fill='#222', width=SCALE)
        else:
            distance = max(abs(a-x),abs(b-y))
            for t in range(0,int(distance),9):
                u,v=t/distance,min(t+5,distance)/distance
                draw.line(((x+(a-x)*u)*SCALE,(y+(b-y)*u)*SCALE,(x+(a-x)*v)*SCALE,(y+(b-y)*v)*SCALE),fill='#222',width=SCALE)


def text(x,y,w,value,size=14,bold=False,underline=False,align='center'):
    f=font(bold,size)
    for i,label in enumerate(value.splitlines()):
        width=draw.textlength(label,font=f)/SCALE
        if width>w-4:
            raise ValueError(f'Text exceeds box: {label!r} ({width:.1f} > {w})')
        tx=x+(w-width)/2 if align=='center' else x+8
        ty=y+i*21
        svg.append(f'<text x="{tx:.2f}" y="{ty+size:.2f}" font-family="Arial, sans-serif" font-size="{size}"'+(' font-weight="bold"' if bold else '')+(' text-decoration="underline"' if underline else '')+f'>{html.escape(label)}</text>')
        draw.text((tx*SCALE,ty*SCALE),label,font=f,fill='#111',anchor='lt')
        if underline: draw.line((tx*SCALE,(ty+size+2)*SCALE,(tx+width)*SCALE,(ty+size+2)*SCALE),fill='#111',width=SCALE)


cells=list(ET.parse(SOURCE).iter('mxCell'))
vertices={c.get('id'):c for c in cells if c.get('vertex')=='1'}


def geometry(c):
    g=c.find('mxGeometry')
    x,y,w,h=[float(g.get(a,'0')) for a in ['x','y','width','height']]
    if c.get('parent') in vertices:
        px,py,_,_=geometry(vertices[c.get('parent')]);x+=px;y+=py
    return x,y,w,h


# Frames first, communication paths next, opaque deployment nodes above paths.
def vertex(c):
    x,y,w,h=geometry(c);value=c.get('renderValue',c.get('value',''));kind=c.get('renderKind')
    if kind=='frame':
        line([(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)])
        size=16 if c.get('id')=='frame' else 14
        tw=draw.textlength(value,font=font(True,size))/SCALE+28
        polygon([(x,y),(x+tw,y),(x+tw,y+15),(x+tw-10,y+27),(x,y+27)])
        text(x+2,y+4,tw-12,value,size,True,align='left')
    elif kind=='node':
        polygon([(x,y),(x+8,y-8),(x+w+8,y-8),(x+w,y)],'#fff9ef')
        polygon([(x+w,y),(x+w+8,y-8),(x+w+8,y+h-8),(x+w,y+h)],'#ddd3c5')
        polygon([(x,y),(x+w,y),(x+w,y+h),(x,y+h)],'#fcf0df')
        labels=value.splitlines()
        text(x,y+14,w,labels[0],13)
        text(x,y+36,w,'\n'.join(labels[1:]),14,True,True)
    elif kind=='artifact':
        polygon([(x+3,y+4),(x+w+3,y+4),(x+w+3,y+h+4),(x+3,y+h+4)],'#b7b2ab')
        polygon([(x,y),(x+w,y),(x+w,y+h),(x,y+h)],'#fcf0df')
        ix,iy=x+w-18,y+7
        polygon([(ix,iy),(ix+8,iy),(ix+12,iy+4),(ix+12,iy+15),(ix,iy+15)],'white')
        line([(ix+8,iy),(ix+8,iy+4),(ix+12,iy+4)])
        for offset in [7,10,13]: line([(ix+2,iy+offset),(ix+9,iy+offset)])
        text(x+4,y+(h-21*len(value.splitlines()))/2,w-28,value,13,True,True)
    elif kind=='note':
        polygon([(x,y),(x+w-14,y),(x+w,y+14),(x+w,y+h),(x,y+h)],'#f7f4f7')
        line([(x+w-14,y),(x+w-14,y+14),(x+w,y+14)])
        text(x+6,y+17,w-26,value,13,align='left')
    elif kind=='text':
        text(x,y+2,w,value,12 if c.get('id')=='footnote' else 13)
    else:
        raise ValueError(f'Unsupported rendering style: {kind}')


for c in vertices.values():
    if c.get('renderKind')=='frame': vertex(c)
for c in cells:
    if c.get('edge')!='1': continue
    g=c.find('mxGeometry');start=g.find("mxPoint[@as='sourcePoint']");end=g.find("mxPoint[@as='targetPoint']")
    points=[start,*g.findall('Array/mxPoint'),end]
    line([(float(p.get('x')),float(p.get('y'))) for p in points], 'dashed=1' in c.get('style',''))
for c in vertices.values():
    if c.get('renderKind')!='frame': vertex(c)
svg.append('</svg>')
STEM.with_suffix('.svg').write_text('\n'.join(svg),encoding='utf-8')
im.resize((W,H),Image.Resampling.LANCZOS).save(STEM.with_suffix('.png'))
print(f'Rendered {STEM.name}: {W} x {H}, SVG + PNG')
