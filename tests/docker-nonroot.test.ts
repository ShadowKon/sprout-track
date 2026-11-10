import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Guards for running the Docker app process as the unprivileged node user.
 * Startup setup (TZ, Prisma generate, crond) stays root; the app must not.
 */
const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf-8');
const startup = readFileSync(path.join(process.cwd(), 'docker-startup.sh'), 'utf-8');

describe('docker non-root app process', () => {
  it('installs su-exec in the image', () => {
    expect(dockerfile).toMatch(/apk add[^\n]*su-exec/);
  });

  it('starts the app through su-exec node when running as root', () => {
    expect(startup).toContain('exec su-exec node "$@"');
    expect(startup.indexOf('exec su-exec node "$@"')).toBeLessThan(startup.lastIndexOf('exec "$@"'));
  });

  it('hands every runtime-written path to node', () => {
    for (const dir of ['/db', '/app/env', '/app/Files', '/app/prisma', '/app/node_modules/.prisma']) {
      expect(startup).toContain(dir);
    }
    expect(startup).toContain('chown node:node /app');
  });
});
