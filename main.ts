// Interpreter for make.fun's tiny stack ISA. Runs every <in>/<id>/program.bin on its input.bin and writes
// <out>/<id>/stdout.bin + exit.txt. Check order per step follows the reference VM: steps, pc, opcode,
// immediate, under/overflow, then the instruction's own traps; a trap keeps the output written so far.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// opcode -> [immediate bytes, pops, pushes]
const T: Record<number, number[]> = {};
const def = (s: string, ops: number[]) => ops.forEach((o) => (T[o] = [+s[0], +s[1], +s[2]]));
def('000', [0x00, 0x34]);
def('101', [0x01]);
def('401', [0x02]);
def('010', [0x03, 0x50, 0x51, 0x53]);
def('012', [0x04]);
def('022', [0x05]);
def('023', [0x06]);
def('033', [0x07]);
def('021', [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22]);
def('011', [0x17, 0x1b, 0x40]);
def('200', [0x30, 0x33]);
def('210', [0x31, 0x32]);
def('020', [0x41]);
def('001', [0x52]);

function run(p: Uint8Array, inp: Uint8Array): [Uint8Array, number] {
  const n = p.length, D = new Int32Array(256), C: number[] = [], M = new Int32Array(256), O = new Uint8Array(65536);
  let sp = 0, ol = 0, ip = 0, pc = 0, st = 0;
  const end = (e: number): [Uint8Array, number] => [O.slice(0, ol), e];
  for (;;) {
    if (st == 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const o = p[pc], t = T[o];
    if (!t) return end(5);
    if (pc + t[0] >= n) return end(9);
    st++;
    const x = pc + 1 + t[0];
    if (sp < t[1]) return end(2);
    if (sp - t[1] + t[2] > 256) return end(3);
    pc = x;
    const b = D[sp - 1], a = D[sp - 2];
    if (o >= 0x10 && o < 0x23 && o != 0x17 && o != 0x1b) {
      let r = 0;
      if (o >= 0x13 && o <= 0x16 && b == 0) return end(4);
      switch (o) {
        case 0x10: r = a + b; break;
        case 0x11: r = a - b; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13: r = a == -2147483648 && b == -1 ? a : a / b; break;
        case 0x14: r = b == -1 ? 0 : a % b; break;
        case 0x15: r = Math.floor((a >>> 0) / (b >>> 0)); break;
        case 0x16: r = (a >>> 0) % (b >>> 0); break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = a >>> (b & 31); break;
        case 0x20: r = +(a == b); break;
        case 0x21: r = +(a < b); break;
        case 0x22: r = +(a >>> 0 < b >>> 0); break;
      }
      D[--sp - 1] = r | 0;
      continue;
    }
    switch (o) {
      case 0x00: return end(0);
      case 0x01: D[sp++] = (p[x - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[x - 4] | (p[x - 3] << 8) | (p[x - 2] << 16) | (p[x - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp++] = b; break;
      case 0x05: D[sp - 1] = a; D[sp - 2] = b; break;
      case 0x06: D[sp++] = a; break;
      case 0x07: D[sp - 1] = D[sp - 3]; D[sp - 3] = a; D[sp - 2] = b; break;
      case 0x17: D[sp - 1] = -b | 0; break;
      case 0x1b: D[sp - 1] = ~b; break;
      case 0x30: case 0x31: case 0x32: {
        const r = ((p[x - 2] | (p[x - 1] << 8)) << 16) >> 16;
        if (o == 0x30 || (o == 0x31) == (D[--sp] == 0)) pc = x + r;
        break;
      }
      case 0x33:
        if (C.length == 64) return end(7);
        C.push(x);
        pc = p[x - 2] | (p[x - 1] << 8);
        break;
      case 0x34:
        if (!C.length) return end(8);
        pc = C.pop()!;
        break;
      case 0x40:
        if (b < 0 || b > 255) return end(6);
        D[sp - 1] = M[b];
        break;
      case 0x41:
        if (b < 0 || b > 255) return end(6);
        M[b] = a;
        sp -= 2;
        break;
      case 0x50: {
        const s = String(b);
        if (ol + s.length > 65536) return end(11);
        sp--;
        for (const c of s) O[ol++] = c.charCodeAt(0);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        O[ol++] = b;
        sp--;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return end(b & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OD = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const rd = (f: string) => { try { return readFileSync(join(I, id, f)); } catch { return new Uint8Array(0); } };
  const [out, e] = run(rd('program.bin'), rd('input.bin'));
  mkdirSync(join(OD, id), { recursive: true });
  writeFileSync(join(OD, id, 'stdout.bin'), out);
  writeFileSync(join(OD, id, 'exit.txt'), e + '\n');
}
