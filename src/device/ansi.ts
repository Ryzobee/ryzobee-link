import type { AnsiSpan } from './types';

const colors = ['#696b74', '#ff6c75', '#91c785', '#efc478', '#82aaff', '#c792ea', '#89dceb', '#d7dae0',
  '#90939d', '#ff8790', '#b4edaa', '#ffe19b', '#a9c4ff', '#e1b0ff', '#b4f0ff', '#ffffff'];

function palette(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return;
  if (index < 16) return colors[index];
  if (index >= 232) { const v = 8 + (index - 232) * 10; return `rgb(${v}, ${v}, ${v})`; }
  const n = index - 16;
  const component = (v: number) => v === 0 ? 0 : 55 + 40 * v;
  return `rgb(${component(Math.floor(n / 36))}, ${component(Math.floor(n / 6) % 6)}, ${component(n % 6)})`;
}

/** ANSI is translated into text spans, never HTML. Control/OSC sequences are discarded. */
export class AnsiDecoder {
  private pending = '';
  private style: Omit<AnsiSpan, 'text'> = {};

  decode(chunk: string): AnsiSpan[] {
    const text = this.pending + chunk;
    this.pending = '';
    const spans: AnsiSpan[] = [];
    let plain = '';
    const flush = () => { if (plain) spans.push({ ...this.style, text: plain }); plain = ''; };
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '\x1b') {
        if (text[i] === '\n' || text[i] === '\t' || text.charCodeAt(i) >= 32) plain += text[i];
        continue;
      }
      flush();
      if (i + 1 >= text.length) { this.pending = text.slice(i); break; }
      if (text[i + 1] === '[') {
        let end = i + 2;
        while (end < text.length && !/[\x40-\x7e]/.test(text[end])) end++;
        if (end === text.length) { this.pending = text.slice(i).slice(-128); break; }
        if (text[end] === 'm') this.sgr(text.slice(i + 2, end));
        i = end;
      } else if (text[i + 1] === ']') {
        const end = /\x07|\x1b\\/.exec(text.slice(i + 2));
        if (!end) { this.pending = text.slice(i).slice(-256); break; }
        i += 1 + end.index + end[0].length;
      } else { i++; }
    }
    flush();
    return spans;
  }

  private sgr(text: string) {
    const values = (text || '0').split(';').map(Number);
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === 0) this.style = {};
      else if (value === 1) this.style.bold = true;
      else if (value === 2) this.style.dim = true;
      else if (value === 22) { delete this.style.bold; delete this.style.dim; }
      else if (value === 39) delete this.style.color;
      else if (value >= 30 && value <= 37) this.style.color = colors[value - 30];
      else if (value >= 90 && value <= 97) this.style.color = colors[value - 90 + 8];
      else if (value === 38 && values[i + 1] === 5) { this.style.color = palette(values[i + 2]); i += 2; }
      else if (value === 38 && values[i + 1] === 2) {
        const rgb = values.slice(i + 2, i + 5);
        if (rgb.length === 3 && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) this.style.color = `rgb(${rgb.join(', ')})`;
        i += 4;
      }
    }
  }
}
