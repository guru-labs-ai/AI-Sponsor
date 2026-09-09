"""Is the save-me-as-AI-Sponsor flow actually working on the live site?

Three things have to agree: a QR drawn into the page, a link beside it, and a
file at the other end. Any one of them can break while the page still looks
perfect, so this checks the LIVE site rather than the repo. The repo would only
prove we still mean to serve it.

Exit 0 if everything holds, 1 with a reason if not.
"""
import re, io, sys, urllib.request

SITE   = 'https://getaisponsor.com'
PAGE   = SITE + '/ai-sponsor-registration.html'
VCF    = SITE + '/aisponsor.vcf'
NAME   = 'AI Sponsor'
NUMBER = '+13073234467'

problems = []


def fetch(url):
    # Cache-bust: Pages sits behind a CDN and we want what it is serving now.
    req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'cb=ci',
                                 headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read().decode('utf-8', 'replace')


def check_file():
    try:
        status, ctype, body = fetch(VCF)
    except Exception as e:
        return problems.append(f'{VCF} could not be fetched ({e}). The link points at nothing')
    if status != 200:
        return problems.append(f'{VCF} returned {status}. The link points at nothing')
    # This header is what makes a phone offer to add a contact. Served as
    # text/plain the file still downloads and the whole thing quietly stops
    # working, which is exactly the failure worth catching.
    if not ctype.split(';')[0].strip() in ('text/x-vcard', 'text/vcard'):
        problems.append(f"content-type is {ctype!r}; phones will not open the add-contact sheet")
    if f'FN:{NAME}' not in body:
        problems.append(f'the contact file no longer carries the name {NAME}')
    if NUMBER not in body:
        problems.append('the contact file no longer carries the WhatsApp number')


def qr_matrix(svg):
    """segno draws the code as horizontal dark runs, so walk the path back into
    a matrix. No rendering library, so there is nothing in CI that can rot."""
    size = int(re.search(r'viewBox="0 0 (\d+)', svg).group(1))
    d = re.search(r'\sd="([^"]+)"', svg).group(1)
    grid = [[0] * size for _ in range(size)]
    x = y = 0
    for t in re.finditer(r'([Mmh])(-?\d+)(?:[ ,](-?\d+)(?:\.5)?)?', d):
        op, a, b = t.group(1), int(t.group(2)), t.group(3)
        if op == 'M':
            x, y = a, int(b)
        elif op == 'm':
            x += a
            y += int(b)
        else:
            for i in range(a):
                if 0 <= y < size and 0 <= x + i < size:
                    grid[y][x + i] = 1
            x += a
    return grid, size


def check_page():
    try:
        status, _, html = fetch(PAGE)
    except Exception as e:
        return problems.append(f'the registration page could not be fetched ({e})')
    if status != 200:
        return problems.append(f'the registration page returned {status}')

    if f'Save me as {NAME}' not in html:
        problems.append('the save card is gone from the registration page')
    if '/aisponsor.vcf' not in html:
        problems.append('the page no longer links to the contact file')

    block = re.search(r'id="saveQr".*?</div>\s*</div>', html, re.S)
    if not block:
        return problems.append('the QR block is gone from the registration page')
    svg = re.search(r'<svg.*?</svg>', block.group(0), re.S)
    if not svg:
        return problems.append('the QR block has no SVG in it')

    import zxingcpp, vobject
    from PIL import Image
    grid, size = qr_matrix(svg.group(0))
    scale = 8
    img = Image.new('L', (size * scale, size * scale), 255)
    px = img.load()
    for r, row in enumerate(grid):
        for c, v in enumerate(row):
            if v:
                for dy in range(scale):
                    for dx in range(scale):
                        px[c * scale + dx, r * scale + dy] = 0

    got = zxingcpp.read_barcode(img)
    if not got:
        return problems.append('the QR in the live page does not decode at all')

    text = got.text
    # The regression that shipped once and reached a real phone: a QR holding a
    # URL is handed to the browser, and the browser drops the file in Downloads
    # instead of offering to save a contact. It looks identical on the page.
    if text.lstrip().upper().startswith(('HTTP://', 'HTTPS://')):
        return problems.append('the QR holds a URL. Phones will download it instead of '
                               'offering to save a contact. It must hold the vCard itself')
    if 'BEGIN:VCARD' not in text:
        return problems.append('the QR does not hold a vCard. It holds: ' + text[:80])

    c = vobject.readOne(text)
    if c.fn.value != NAME:
        problems.append(f'the QR contact is named {c.fn.value!r}, not {NAME}')
    if c.tel.value.replace(' ', '') != NUMBER:
        problems.append(f'the QR contact carries {c.tel.value}, not the WhatsApp number')
    if not problems:
        print(f'QR holds a contact: {c.fn.value} {c.tel.value}')


if __name__ == '__main__':
    check_file()
    check_page()
    if problems:
        for p in problems:
            print(f'::error::{p}')
        sys.exit(1)
    print('contact card is working on the live site')
