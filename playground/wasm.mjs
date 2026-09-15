// Host adapter only. The module has no imports: all game rules execute in Rust.
// File URLs support headless Node conformance; HTTP URLs support the browser.
async function bytes(url) {
  if (url.protocol === 'file:') return new Uint8Array(await (await import('node:fs/promises')).readFile(url));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
export async function readData(url) { return JSON.parse(new TextDecoder().decode(await bytes(url))); }
const { instance } = await WebAssembly.instantiate(await bytes(new URL('./fishing.wasm?v=0.2.0', import.meta.url)), {});
const wasm = instance.exports;
const encoder = new TextEncoder(), decoder = new TextDecoder();
export function call(op, payload) {
  const input = encoder.encode(JSON.stringify({ op, ...payload }, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('numbers must be finite');
    return value;
  }));
  if (input.length > 65536) throw new RangeError('request exceeds 64 KiB');
  const pointer = wasm.fishing_alloc(input.length);
  if (!pointer) throw new Error('WASM input allocation failed');
  let output = 0, length = 0;
  try {
    new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
    const packed = wasm.fishing_call(pointer, input.length);
    output = Number(packed & 0xffffffffn); length = Number(packed >> 32n);
    const result = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, output, length)));
    if (Object.hasOwn(result, 'error')) throw new RangeError(result.error);
    return result.ok;
  } finally {
    // Re-read memory.buffer after calls: WASM allocation may grow memory.
    if (output) wasm.fishing_free(output, length);
    wasm.fishing_free(pointer, input.length);
  }
}
