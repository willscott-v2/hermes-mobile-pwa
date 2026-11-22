import { describe, expect, it } from 'vitest';
import { assistantNameFrom, DEFAULT_ASSISTANT_NAME } from './assistantName';

describe('assistantNameFrom', () => {
  it('falls back to the neutral default when unset, blank or not a string', () => {
    expect(DEFAULT_ASSISTANT_NAME).toBe('Hermes');
    expect(assistantNameFrom(undefined)).toBe('Hermes');
    expect(assistantNameFrom('   ')).toBe('Hermes');
    expect(assistantNameFrom(42)).toBe('Hermes');
  });

  it('uses a configured name, trimmed, single-spaced and capped', () => {
    expect(assistantNameFrom('  Ada  ')).toBe('Ada');
    expect(assistantNameFrom('Ada\n Lovelace')).toBe('Ada Lovelace');
    expect(assistantNameFrom('x'.repeat(60))).toHaveLength(40);
  });
});
