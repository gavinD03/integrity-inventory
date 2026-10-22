declare module 'jsbarcode/bin/barcodes/CODE128' {
  export class CODE128 {
    constructor(data: string, options: Record<string, unknown>);
    valid(): boolean;
    encode(): { text: string; data: string };
  }
}
