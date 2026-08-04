export interface RuntimeOption {
  id: string;
  label: string;
}

export interface RuntimeCatalog {
  profiles: RuntimeOption[];
  projects: RuntimeOption[];
  models: RuntimeOption[];
}

export interface RuntimeSelection {
  profile?: string;
  projectId?: string;
  model?: string;
}

type RawOption = string | { id?: string; name?: string; label?: string; value?: string; title?: string };

function normalizeOptions(values?: RawOption[]): RuntimeOption[] {
  const seen = new Set<string>();
  const options: RuntimeOption[] = [];
  for (const value of values ?? []) {
    const id = typeof value === 'string' ? value : value.id ?? value.value ?? value.name ?? value.title ?? '';
    const label = typeof value === 'string' ? value : value.label ?? value.name ?? value.title ?? id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

export function normalizeRuntimeCatalog(input: { profiles?: RawOption[]; projects?: RawOption[]; models?: RawOption[] }): RuntimeCatalog {
  return {
    profiles: normalizeOptions(input.profiles),
    projects: normalizeOptions(input.projects),
    models: normalizeOptions(input.models),
  };
}

export function sanitizeRuntimeSelection(selection: RuntimeSelection, catalog: RuntimeCatalog): RuntimeSelection {
  return {
    profile: catalog.profiles.some((option) => option.id === selection.profile) ? selection.profile : undefined,
    projectId: catalog.projects.some((option) => option.id === selection.projectId) ? selection.projectId : undefined,
    model: catalog.models.some((option) => option.id === selection.model) ? selection.model : undefined,
  };
}

export const EMPTY_RUNTIME_CATALOG: RuntimeCatalog = { profiles: [], projects: [], models: [] };
