import {
  formatVolume,
  localDateTime,
  parseLocalDateTime,
  parseVolume,
  volumeError,
} from './order-form.helpers';

describe('volume helpers', () => {
  it.each([0.0000001, 0.125, 1e21, 1.2345678901234568e25, Number.MIN_VALUE, Number.MAX_VALUE])(
    'formats %s without exponential notation or changing the value',
    (value) => {
      const formatted = formatVolume(value);
      expect(formatted).not.toMatch(/[eE]/);
      expect(parseVolume(formatted)).toBe(value);
    },
  );
  it('accepts decimal commas and points', () => {
    expect(parseVolume('0,05')).toBe(0.05);
    expect(parseVolume('1.25')).toBe(1.25);
    expect(volumeError('0,05')).toBeNull();
    expect(volumeError('1.25')).toBeNull();
  });

  it.each(['', 'abc', '1e3', 'e333', 'NaN', 'Infinity', '1,2.3', ' 1 ', '.5', '1.'])(
    'rejects invalid volume format: %j',
    (value) => {
      expect(parseVolume(value)).toBeNull();
    },
  );

  it.each(['0', '0.00', '0,00', '-1'])('rejects nonpositive volumes: %j', (value) => {
    expect(parseVolume(value)).toBeNull();
  });

  it('rejects numeric overflow', () => {
    const value = '9'.repeat(309);
    expect(parseVolume(value)).toBeNull();
    expect(volumeError(value)).toMatchObject({ kind: 'positive' });
  });

  it('reports a required error for an empty value', () => {
    expect(volumeError('')).toMatchObject({ kind: 'required' });
  });

  it.each(['abc', '1e3', '-1', '1,2.3', 'NaN', 'Infinity'])(
    'reports a format error for %j',
    (value) => {
      expect(volumeError(value)).toMatchObject({ kind: 'pattern' });
    },
  );

  it.each(['0', '0.00', '0,00'])('reports a positive-value error for %j', (value) => {
    expect(volumeError(value)).toMatchObject({ kind: 'positive' });
  });
});

describe('local date and time helpers', () => {
  it('formats local fields and parses them without discarding seconds', () => {
    const date = new Date(2026, 10, 14, 12, 34, 56);
    expect(localDateTime(date)).toBe('2026-11-14T12:34:56');
    expect(parseLocalDateTime(localDateTime(date))).toBe(date.getTime());
    expect(parseLocalDateTime('2026-11-14T12:34')).toBe(
      new Date(2026, 10, 14, 12, 34, 0).getTime(),
    );
  });

  it('rejects impossible dates and timestamps with a timezone', () => {
    for (const value of ['', '2026-02-30T12:00', '2026-11-14T25:00', '2026-11-14T12:00:00Z']) {
      expect(parseLocalDateTime(value)).toBeNull();
    }
  });
});
