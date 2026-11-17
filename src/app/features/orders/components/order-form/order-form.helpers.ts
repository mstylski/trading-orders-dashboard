const volumePattern = /^\d+(?:[.,]\d+)?$/;

// Expand JavaScript's shortest round-trip representation without rounding it.
export function formatVolume(value: number): string {
  const [coefficient, exponentText] = String(value).split('e');
  if (exponentText === undefined) return coefficient.replace('.', ',');
  const [integer, fraction = ''] = coefficient.split('.');
  const digits = integer + fraction;
  const decimalPosition = integer.length + Number(exponentText);
  if (decimalPosition <= 0) return `0,${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return digits + '0'.repeat(decimalPosition - digits.length);
  return `${digits.slice(0, decimalPosition)},${digits.slice(decimalPosition)}`;
}

export function parseVolume(value: string): number | null {
  if (!volumePattern.test(value)) return null;
  const volume = Number(value.replace(',', '.'));
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

export function volumeError(value: string): { kind: string; message: string } | null {
  if (!value) return { kind: 'required', message: 'Podaj wolumen.' };
  if (!volumePattern.test(value))
    return { kind: 'pattern', message: 'Podaj wolumen w postaci liczby, np. 0,05.' };
  return parseVolume(value) === null
    ? { kind: 'positive', message: 'Podaj wolumen większy od zera.' }
    : null;
}

export function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseLocalDateTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) && localDateTime(date) === normalized
    ? date.getTime()
    : null;
}
