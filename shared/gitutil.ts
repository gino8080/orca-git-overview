/** Utilità pure per il worker, isolate per poterle testare. */

/** Limita i lavori asincroni concorrenti; gli altri attendono il turno in ordine di arrivo. */
export function createLimiter(max: number): <T>(job: () => Promise<T>) => Promise<T> {
  let busy = 0;
  const waiters: Array<() => void> = [];
  return async function limited<T>(job: () => Promise<T>): Promise<T> {
    if (busy >= max) await new Promise<void>((res) => waiters.push(res));
    else busy++;
    try {
      return await job();
    } finally {
      // Passaggio di consegna: lo slot liberato va al primo in attesa senza passare da 0.
      const next = waiters.shift();
      if (next) next();
      else busy--;
    }
  };
}

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};

/**
 * Toglie il quoting in stile C che git applica ai percorsi con `"`, `\`, tab, newline o
 * caratteri di controllo (anche con `core.quotepath=false`). I percorsi non quotati restano uguali.
 */
export function unquoteC(s: string): string {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...enc.encode(ch));
      continue;
    }
    const next = body[++i];
    if (next !== undefined && next in C_ESCAPES) bytes.push(C_ESCAPES[next]);
    else if (next !== undefined && /[0-7]/.test(next)) {
      // Ottale a 3 cifre: byte grezzo (UTF-8 con quotepath attivo).
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (next !== undefined) bytes.push(...enc.encode(next));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
