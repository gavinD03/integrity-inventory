import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { composeSku, emptyParts, freeSku, learnCodes, parseSku, sizeText } from './sku';
import { buildLabelPdf, code128Bits } from './labels';
import type { SkuCode } from './types';

const c = (segment: SkuCode['segment'], code: string, label = code): SkuCode => ({ id: code, segment, code, label, active: true });
const codes: SkuCode[] = [
  c('category', 'FIT'), c('category', 'WEL'), c('category', 'CON'),
  c('material', 'PVC'), c('material', 'PMP'),
  c('item', 'E90'), c('item', 'RBU'),
  c('size', '100', '1"'), c('size', '125', '1-1/4"'), c('size', '075', '3/4"'),
];

describe('SKU composition', () => {
  it('composes and drops empty segments', () => {
    expect(composeSku({ ...emptyParts(), category: 'FIT', material: 'PVC', item: 'E90', size: '100' })).toBe('FIT-PVC-E90-100');
    expect(composeSku({ ...emptyParts(), category: 'CON', item: 'PTF' })).toBe('CON-PTF');
    expect(composeSku({ ...emptyParts(), category: 'FIT', material: 'PVC', item: 'RBU', size: '125', size2: '100' })).toBe('FIT-PVC-RBU-125100');
  });
  it('appends -2, -3 on collision', () => {
    expect(freeSku('FIT-PVC-E90-100', ['fit-pvc-e90-100'])).toBe('FIT-PVC-E90-100-2');
    expect(freeSku('FIT-PVC-E90-100', ['FIT-PVC-E90-100', 'FIT-PVC-E90-100-2'])).toBe('FIT-PVC-E90-100-3');
    expect(freeSku('FIT-PVC-E90-075', ['FIT-PVC-E90-100'])).toBe('FIT-PVC-E90-075');
  });
  it('parses existing SKUs and reports guesses', () => {
    expect(parseSku('FIT-PVC-E90-100', codes).parts).toMatchObject({ category: 'FIT', material: 'PVC', item: 'E90', size: '100' });
    expect(parseSku('WEL-PMP-J10S', codes).parts).toMatchObject({ category: 'WEL', material: 'PMP', item: 'J10S', size: '' });
    const r = parseSku('FIT-PVC-RBU-125100', codes);
    expect(r.parts).toMatchObject({ size: '125', size2: '100' });
    expect(sizeText('FIT-PVC-RBU-125100', codes)).toBe('1-1/4" x 1"');
  });
  it('learns unknown codes from existing SKUs', () => {
    const l = learnCodes(['WEL-PMP-J10S', 'FIT-SHB-CPL-050', 'CON-PTF'], codes);
    expect(l.map((x) => `${x.segment}:${x.code}`)).toEqual(['material:SHB', 'item:CPL', 'item:J10S', 'item:PTF', 'size:050']);
  });
});

describe('labels', () => {
  const skus = ['FIT-PVC-E90-100', 'FIT-PVC-RBU-125100', 'WEL-PMP-J10S', 'CON-PTF', 'FIT-CPV-TEE-075', 'MED-CARB-1CF', 'FIT-SHB-CPL-050-2'];
  it('encodes Code 128', () => {
    expect(code128Bits('FIT-PVC-E90-100').length).toBe(200);
  });
  it('builds Avery 5160 and 2x1 PDFs', async () => {
    const labels = Array.from({ length: 33 }, (_, i) => {
      const sku = skus[i % skus.length];
      return { sku, name: `1" PVC 90 elbow Schedule 40 socket sample ${i + 1}`, size: sizeText(sku, codes) };
    });
    const dir = process.env.LABEL_OUT;
    for (const f of ['avery5160', 'thermal2x1'] as const) {
      const pdf = await buildLabelPdf(f === 'thermal2x1' ? labels.slice(0, skus.length) : labels, f);
      const buf = Buffer.from(await pdf.arrayBuffer());
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
      if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${f}.pdf`, buf); }
    }
  });
});
