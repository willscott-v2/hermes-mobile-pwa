// Profile-scoping primitives for the Conversations profile switcher.
//
// A session id can recur under two server profiles (e.g. a "new chat" stamped by
// both `default` and `sales-test`), so every decision that keeps one profile's
// previews, history, draft, or send away from another is expressed here in pure,
// testable form and reused by App.

// Identity for a session row includes its profile so the same id under two
// profiles never collapses into one. An untagged row means the default profile.
function normalizeProfile(profile?: string): string {
  const value = profile?.trim();
  return value || 'default';
}

export function sessionRowKey(id: string, profile?: string): string {
  return `${normalizeProfile(profile)}:${id}`;
}

// Exact profile scoping (defense-in-depth on top of the server-side filter): only
// rows stamped with the active profile are admitted. An untagged row means default,
// so it survives when default is active but is dropped from every other profile —
// this is what keeps a private default-only session out of the sales-test view even
// if the server over-returns or a pre-switch page is still in flight.
export function admitSessionsForProfile<T extends { id: string; profile?: string }>(
  rows: T[],
  activeProfile: string,
): T[] {
  const target = normalizeProfile(activeProfile);
  return rows.filter((row) => normalizeProfile(row.profile) === target);
}

// Which profile is active on a fresh connection. A remembered host-scoped
// preference is trusted only while the server still advertises it; otherwise we
// fall back to the server's current profile, then the first advertised profile.
// This is what stops a remembered private profile from silently scoping a view
// the server no longer offers under that host.
export function resolveActiveProfile(
  advertised: string[],
  currentProfile: string | undefined,
  remembered: string | null | undefined,
): string {
  const profiles = advertised.filter((profile) => typeof profile === 'string' && profile.trim());
  if (profiles.length) {
    if (remembered && remembered.trim() && profiles.includes(remembered.trim())) return remembered.trim();
    if (currentProfile && profiles.includes(currentProfile)) return currentProfile;
    return profiles[0];
   }
  // No advertised list to anchor on, so a remembered host-scoped preference alone
  // is not enough to trust (the advertised list is the only thing that confirms a
  // profile exists). Prefer the caller's current profile as the last server-known
  // signal, else default.
  if (currentProfile && currentProfile.trim()) return currentProfile.trim();
  return 'default';
}

// New Chat must start from the active profile, never from a profile left over on
// the runtime selection from a previous connection or a previously active profile.
// An empty/whitespace active profile yields no profile key at all.
export function seedNewChatSelection(activeProfile: string): { profile?: string } {
  const profile = activeProfile?.trim();
  return profile ? { profile } : { profile: undefined };
}

// A session-list fetch, a new-chat/resume open, or a send that began under one
// generation+profile is dropped once the generation has moved on OR the active
// profile changed. This is what stops a switch-during-fetch from showing the old
// profile's pages and from delivering a send to the prior profile.
export function isProfileActionStale(
  generation: number,
  currentGeneration: number,
  requestedProfile: string,
  activeProfile: string,
): boolean {
  if (generation !== currentGeneration) return true;
  return normalizeProfile(requestedProfile) !== normalizeProfile(activeProfile);
}

// A history page is admitted into a history state only when its session id and its
// profile both match the state's scope. Because the same id can recur across
// profiles, the profile check is what prevents one profile's transcript from
// leaking into another's.
export function historyPageBelongsToScope(
  page: { sessionId: string; profile?: string },
  scope: { sessionId: string; profile?: string },
): boolean {
  if (page.sessionId !== scope.sessionId) return false;
  return normalizeProfile(page.profile) === normalizeProfile(scope.profile);
}
