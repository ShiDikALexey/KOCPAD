/**
 * Text encodings and line endings.
 *
 * KOCPAD edits text as normalised LF strings, but files on Windows are not always
 * UTF-8/LF: old Notepad saved cp1251, some tools write UTF-16 with a BOM, and Git
 * checkout usually uses CRLF. Reading such a file as UTF-8 either breaks the text
 * or silently rewrites the whole file on save, so every document keeps the
 * encoding it came from and writes it back unchanged.
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'cp1251';
export type Eol = '\n' | '\r\n';

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  /** True when the file started with a byte-order mark. */
  bom: boolean;
  eol: Eol;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function stripBom(bytes: Uint8Array, length: number): Uint8Array {
  return length ? bytes.subarray(length) : bytes;
}

/** Dominant line ending of a decoded text; mixed files follow the majority. */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      if (index > 0 && text[index - 1] === '\r') crlf += 1;
      else lf += 1;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** Normalises any line ending to LF for the editor. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function validUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Heuristic for BOM-less UTF-16LE: Cyrillic/Latin text has many zero high bytes. */
function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  let zeros = 0;
  const limit = Math.min(bytes.length, 512);
  for (let index = 1; index < limit; index += 2) {
    if (bytes[index] === 0) zeros += 1;
  }
  return zeros / (limit / 2) > 0.3;
}

export function decodeText(bytes: Uint8Array): DecodedText {  let encoding: TextEncoding = 'utf-8';
  let bom = false;
  let payload = bytes;

  if (startsWith(bytes, UTF8_BOM)) {
    bom = true;
    payload = stripBom(bytes, 3);
  } else if (startsWith(bytes, UTF16LE_BOM)) {
    encoding = 'utf-16le';
    bom = true;
    payload = stripBom(bytes, 2);
  } else if (startsWith(bytes, UTF16BE_BOM)) {
    encoding = 'utf-16be';
    bom = true;
    payload = stripBom(bytes, 2);
  } else if (validUtf8(bytes)) {
    encoding = 'utf-8';
  } else if (looksLikeUtf16Le(bytes)) {
    encoding = 'utf-16le';
  } else {
    // The common legacy case on Russian Windows: old Notepad saved cp1251.
    encoding = 'cp1251';
  }

  const label = encoding === 'utf-8' ? 'utf-8' : encoding;
  const text = new TextDecoder(label, { fatal: false }).decode(payload);
  return { text: normalizeEol(text), encoding, bom, eol: detectEol(text) };
}

/** Re-reads bytes with a forced encoding ("Open as…"). BOM handling is kept. */
export function decodeAs(bytes: Uint8Array, encoding: TextEncoding): DecodedText {
  const detected = decodeText(bytes);
  const bomLength = detected.bom ? (detected.encoding === 'utf-8' ? 3 : 2) : 0;
  const payload = stripBom(bytes, bomLength);
  const label = encoding === 'utf-8' ? 'utf-8' : encoding;
  const text = normalizeEol(new TextDecoder(label, { fatal: false }).decode(payload));
  return { text, encoding, bom: detected.bom, eol: detectEol(text) };
}

let reverseCp1251: Map<string, number> | null = null;
/** Built from the platform decoder, so the table cannot drift from its source. */
function cp1251Map(): Map<string, number> {
  if (reverseCp1251) return reverseCp1251;
  const decoder = new TextDecoder('windows-1251');
  const map = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) {
    const char = decoder.decode(new Uint8Array([byte]));
    if (char && !map.has(char)) map.set(char, byte);
  }
  reverseCp1251 = map;
  return map;
}

/** Encodes text back into its original encoding and line endings. */
export function encodeText(
  text: string,
  encoding: TextEncoding,
  bom: boolean,
  eol: Eol,
): Uint8Array<ArrayBuffer> {
  const withEol = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;

  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(withEol);
    return bom ? concat([new Uint8Array(UTF8_BOM), body]) : body;
  }

  if (encoding === 'utf-16le') {
    const body = new Uint8Array(withEol.length * 2);
    for (let index = 0; index < withEol.length; index += 1) {
      const code = withEol.charCodeAt(index);
      body[index * 2] = code & 0xff;
      body[index * 2 + 1] = code >> 8;
    }
    return bom ? concat([new Uint8Array(UTF16LE_BOM), body]) : body;
  }

  if (encoding === 'utf-16be') {
    const body = new Uint8Array(withEol.length * 2);
    for (let index = 0; index < withEol.length; index += 1) {
      const code = withEol.charCodeAt(index);
      body[index * 2] = code >> 8;
      body[index * 2 + 1] = code & 0xff;
    }
    return bom ? concat([new Uint8Array(UTF16BE_BOM), body]) : body;
  }

  const map = cp1251Map();
  const bytes: number[] = [];
  for (const char of withEol) {
    const byte = map.get(char);
    // Characters cp1251 cannot represent are replaced, not silently dropped.
    bytes.push(byte ?? '?'.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Short label for the status bar. */
export function encodingLabel(encoding: TextEncoding, bom: boolean, eol: Eol): string {
  const name = encoding === 'utf-8' ? 'UTF-8' : encoding === 'cp1251' ? 'cp1251' : 'UTF-16';
  const parts = [name];
  if (eol === '\r\n') parts.push('CRLF');
  if (bom) parts.push('BOM');
  return parts.join(' · ');
}
