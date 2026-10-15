const path = require('node:path');
const { checkConfig, readConfig } = require('../../scripts/lib/safety.cjs');
const { role } = require('../../config/environment.json');
const root = path.resolve(__dirname, '../..');

describe('Cloudflare environment boundaries', () => {
  it('validates account, Worker, D1, URLs, and every Durable Object lifecycle', () => {
    expect(checkConfig(root)).toBe(role);
  });
  it('keeps local resources isolated from deployed resources', () => {
    const local = readConfig(root, 'local');
    expect(local.name).not.toBe(readConfig(root).name);
    expect(local.d1_databases[0].database_id).toBe('00000000-0000-0000-0000-000000000000');
    expect(local.durable_objects.bindings.every((binding) => !binding.script_name)).toBe(true);
  });
  if (role === 'development') {
    it('defaults to staging without a production database binding', () => {
      const staging = readConfig(root, 'staging');
      expect(readConfig(root).name).toBe('syncroedit-dev');
      expect(staging.d1_databases[0].database_id).toBe(
        readConfig(root).d1_databases[0].database_id
      );
      expect(staging.migrations).toEqual([]);
    });
  }
});
