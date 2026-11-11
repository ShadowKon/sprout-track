import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Guards for running the Docker app process as the unprivileged node user.
 * Startup setup (TZ, Prisma generate, crond) stays root; the app must not.
 */
const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf-8');
const startup = readFileSync(path.join(process.cwd(), 'docker-startup.sh'), 'utf-8');
const cronScript = readFileSync(path.join(process.cwd(), 'scripts/run-notification-cron.sh'), 'utf-8');
const cronSetup = readFileSync(path.join(process.cwd(), 'scripts/setup-notification-cron.ts'), 'utf-8');

describe('docker non-root app process', () => {
  it('installs su-exec in the image', () => {
    expect(dockerfile).toMatch(/apk add[^\n]*su-exec/);
  });

  it('starts the app through su-exec node when running as root', () => {
    expect(startup).toContain('exec su-exec node "$@"');
    expect(startup.indexOf('exec su-exec node "$@"')).toBeLessThan(startup.lastIndexOf('exec "$@"'));
  });

  it('hands every runtime-written path to node, but not /app itself', () => {
    for (const dir of ['/db', '/app/env', '/app/Files', '/app/prisma', '/app/node_modules/.prisma']) {
      expect(startup).toContain(dir);
    }
    // A node-owned /app would let the app swap root-owned scripts/ for its own.
    expect(startup).not.toMatch(/chown node:node \/app\s*$/m);
  });

  it('never sources the node-writable env file as root', () => {
    expect(startup).not.toMatch(/^\s*\.\s+"?\$ENV_FILE/m);
    expect(cronScript).not.toMatch(/^\s*\.\s+"?\$PROJECT_DIR\/\.env/m);
    expect(startup).toContain('load_env_file "$ENV_FILE"');
  });

  it('runs prisma, the seed and migrations as node', () => {
    for (const line of startup.split('\n').filter(l => /^\s*(npx prisma |npm run prisma:generate|node scripts\/convert-)/.test(l))) {
      throw new Error(`runs as root: ${line.trim()}`);
    }
    expect(startup).toContain('$AS_NODE npx prisma db seed');
  });

  it('runs the cron job as node while crond stays root', () => {
    expect(startup).toContain('export CRON_RUN_AS=node');
    expect(cronSetup).toMatch(/su-exec \$\{process\.env\.CRON_RUN_AS\}/);
  });
});
