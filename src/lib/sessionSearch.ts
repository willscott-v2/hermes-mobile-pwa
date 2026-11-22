import type { HermesSession } from './hermesApi';

// Conversations search (see docs/PWA-ISSUES-2026-11-19.md, issue 1).
//
// The recent list the PWA pages through comes from `GET /api/sessions`, which excludes
// hidden rows by design; the canonical "Bot Chat" (Bot Mode identity) is hidden=1 and so
// can never be found by filtering loaded rows, no matter how many pages are loaded.
// Search therefore also consults the server's profile-scoped `GET /api/sessions/search`
// and merges what comes back. The ordinary listing is deliberately NOT widened: hidden
// rows only surface when they match what the user typed, under the active profile.

const MIN_SERVER_QUERY_LENGTH = 2;

export function searchQueryForServer(raw: string): string | null {
  const query = raw.trim();
  return query.length >= MIN_SERVER_QUERY_LENGTH ? query : null;
}

function haystack(session: HermesSession): string {
  return [session.title, session.preview, session.workspace, session.source].filter(Boolean).join(' ').toLowerCase();
}

export function sessionMatchesQuery(session: HermesSession, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return haystack(session).includes(query);
}

function profileTag(profile?: string): string {
  return profile?.trim() || 'default';
}

export function sessionKey(session: HermesSession): string {
  return `${profileTag(session.profile)}\u0000${session.id}`;
}

export interface MergeSearchInput {
  loaded: HermesSession[];
  remote: HermesSession[];
  query: string;
  profile: string;
}

// Order: exact title matches first, then partial title matches, then remaining loaded
// substring matches in their list order, then remaining server hits (content-only matches)
// in server order. Remote rows that duplicate a loaded row are dropped in favour of the
// loaded copy; rows tagged with another profile are never admitted into the active
// profile's view.
export function mergeSearchResults({ loaded, remote, query: rawQuery, profile }: MergeSearchInput): HermesSession[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return loaded;
  const active = profileTag(profile);
  const seen = new Set<string>();
  const tiers: HermesSession[][] = [[], [], [], []];
  const titleTier = (session: HermesSession): number | null => {
    const title = (session.title ?? '').trim().toLowerCase();
    if (title && title === query) return 0;
    if (title.includes(query)) return 1;
    return null;
  };

  for (const session of loaded) {
    if (!sessionMatchesQuery(session, query)) continue;
    const key = sessionKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    tiers[titleTier(session) ?? 2].push(session);
  }
  for (const session of remote) {
    if (!session.id) continue;
    if (session.profile && profileTag(session.profile) !== active) continue;
    const stamped = session.profile ? session : { ...session, profile: active };
    const key = sessionKey(stamped);
    if (seen.has(key)) continue;
    seen.add(key);
    tiers[titleTier(stamped) ?? 3].push(stamped);
  }
  return tiers.flat();
}
