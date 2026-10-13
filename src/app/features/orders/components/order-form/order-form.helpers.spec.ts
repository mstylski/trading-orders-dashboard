import { parseVolume, volumeError } from './order-form.helpers';

describe('volume helpers', () => {
  it('accepts decimal separators and rejects values outside valid positive numbers', () => {
    expect(parseVolume('0,05')).toBe(0.05);
    expect(parseVolume('1.25')).toBe(1.25);
    expect(parseVolume('0')).toBeNull();
    expect(parseVolume('1e3')).toBeNull();
    expect(volumeError('')).toMatchObject({ kind: 'required' });
    expect(volumeError('abc')).toMatchObject({ kind: 'pattern' });
    expect(volumeError('0')).toMatchObject({ kind: 'positive' });
  });
});
