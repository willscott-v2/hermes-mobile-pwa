// The display name of the assistant on the main pinned chat ("Talk to {name}"). Set
// VITE_ASSISTANT_NAME at build time (for example in a gitignored .env.local); defaults to "Hermes"
// so the published source carries no personal assistant name.
export const DEFAULT_ASSISTANT_NAME = 'Hermes';

export function assistantNameFrom(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return value || DEFAULT_ASSISTANT_NAME;
}

export const ASSISTANT_NAME = assistantNameFrom(import.meta.env.VITE_ASSISTANT_NAME);
