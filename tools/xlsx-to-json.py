# Exports an .xlsx workbook's cell values to JSON using only the Python
# standard library (no spreadsheet dependency). Used to read the Unbound
# trainer documents for tools/import-unbound-bosses.mjs; the workbook and
# its export are not committed.
#
# Usage: python3 -I tools/xlsx-to-json.py <workbook.xlsx> <out.json>
# Output: { sheets: { name: { state, rows: [{ row, cells: { colIndex: value } }] } } }
import sys, zipfile, json, re
import xml.etree.ElementTree as ET
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships'}
path, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(path)
shared = []
if 'xl/sharedStrings.xml' in z.namelist():
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    for si in root.findall('m:si', NS):
        shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
wb = ET.fromstring(z.read('xl/workbook.xml'))
rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
target = {r.get('Id'): r.get('Target') for r in rels.findall('rel:Relationship', NS)}
def col(ref):
    letters = re.match(r'[A-Z]+', ref).group(0); n = 0
    for ch in letters: n = n * 26 + ord(ch) - 64
    return n - 1
sheets = {}
for s in wb.find('m:sheets', NS):
    name = s.get('name'); rid = s.get('{%s}id' % NS['r'])
    t = target[rid]; t = t if t.startswith('xl/') else 'xl/' + t.lstrip('/')
    root = ET.fromstring(z.read(t))
    rows = []
    for row in root.iter('{%s}row' % NS['m']):
        r = {}
        for c in row.findall('m:c', NS):
            v = c.find('m:v', NS); typ = c.get('t')
            if typ == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
            elif v is None: continue
            elif typ == 's': val = shared[int(v.text)]
            else: val = v.text
            if val not in (None, ''): r[col(c.get('r'))] = val
        if r: rows.append({'row': int(row.get('r')), 'cells': r})
    sheets[name] = {'state': s.get('state') or 'visible', 'rows': rows}
json.dump({'sheets': sheets}, open(out, 'w'))
for n, s in sheets.items(): print(f"{n!r} [{s['state']}] rows={len(s['rows'])}")
