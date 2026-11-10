import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, isHashedPin } from '@/app/api/utils/pin-utils';

describe('pin-utils', () => {
  it('hashPin produces a salt:hash value that is not the PIN', async () => {
    const hashed = await hashPin('482913');
    expect(isHashedPin(hashed)).toBe(true);
    expect(hashed).not.toContain('482913');
  });

  it('verifies a hashed PIN without asking for a rehash', async () => {
    const hashed = await hashPin('482913');
    expect(await verifyPin('482913', hashed)).toEqual({ valid: true, needsRehash: false });
    expect(await verifyPin('482914', hashed)).toEqual({ valid: false, needsRehash: false });
  });

  it('accepts a matching legacy plaintext PIN and flags it for rehash', async () => {
    expect(await verifyPin('111222', '111222')).toEqual({ valid: true, needsRehash: true });
  });

  it('rejects a wrong legacy plaintext PIN without flagging a rehash', async () => {
    expect(await verifyPin('111223', '111222')).toEqual({ valid: false, needsRehash: false });
    expect(await verifyPin('1112', '111222')).toEqual({ valid: false, needsRehash: false });
  });

  it('rejects empty input or a missing stored value', async () => {
    expect(await verifyPin('', '111222')).toEqual({ valid: false, needsRehash: false });
    expect(await verifyPin('111222', null)).toEqual({ valid: false, needsRehash: false });
  });
});
