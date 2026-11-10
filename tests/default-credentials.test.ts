import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { generateLoginPin, lockedPinHash, isHashedPin, verifyPin } from '@/app/api/utils/pin-utils';
import { generateAdminPassword } from '@/app/api/utils/password-utils';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const serverFiles = [...sourceFiles(path.join(process.cwd(), 'app/api')), path.join(process.cwd(), 'prisma/seed.ts')];

describe('no default credentials in server code', () => {
  it('never hardcodes the old default PIN', () => {
    const offenders = serverFiles.filter((f) => readFileSync(f, 'utf-8').includes('111222'));
    expect(offenders).toEqual([]);
  });

  it('never falls back to or seeds the "admin" admin password', () => {
    const offenders = serverFiles.filter((f) => /adminPass\s*[:=]\s*(encrypt\()?'admin'|decryptedAdminPass = 'admin'|currentPass = 'admin'/.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('sets securityPin on every settings create (the schema default is still 111222)', () => {
    const offenders: string[] = [];
    for (const f of serverFiles) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/settings\.create\(\{\s*data:\s*\{/g)) {
        const block = src.slice(m.index!, src.indexOf('}', m.index! + m[0].length));
        if (!block.includes('securityPin')) offenders.push(`${path.relative(process.cwd(), f)}@${m.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('bootstrap credential generators', () => {
  it('generateLoginPin returns 6 digits', () => {
    for (let i = 0; i < 50; i++) expect(generateLoginPin()).toMatch(/^\d{6}$/);
  });

  it('lockedPinHash is a hash no short PIN can match', async () => {
    const locked = await lockedPinHash();
    expect(isHashedPin(locked)).toBe(true);
    expect((await verifyPin('000000', locked)).valid).toBe(false);
    expect(await lockedPinHash()).not.toBe(locked);
  });

  it('generateAdminPassword returns 16 URL-safe characters', () => {
    const pass = generateAdminPassword();
    expect(pass).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(generateAdminPassword()).not.toBe(pass);
  });
});
