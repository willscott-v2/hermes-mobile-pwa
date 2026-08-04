import { describe, expect, it } from 'vitest';
import { normalizeRuntimeCatalog, sanitizeRuntimeSelection } from './runtimeOptions';

describe('runtime options', () => {
  it('dedupes and labels catalog values', () => {
    const catalog = normalizeRuntimeCatalog({
      profiles: ['default', 'default', 'research'],
      projects: [{ id: 'p1', name: 'Mobile PWA' }],
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
    });
    expect(catalog.profiles).toEqual([{ id: 'default', label: 'default' }, { id: 'research', label: 'research' }]);
    expect(catalog.projects[0].label).toBe('Mobile PWA');
  });

  it('drops selections not present in the catalog', () => {
    const selection = sanitizeRuntimeSelection({ profile: 'missing', projectId: 'p1', model: 'm1' }, normalizeRuntimeCatalog({ projects: [{ id: 'p1', name: 'P1' }] }));
    expect(selection).toEqual({ projectId: 'p1' });
  });
});
