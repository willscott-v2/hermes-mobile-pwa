// Pinned chats: resolve an explicitly pinned default-profile session, never a guess.
//
// There is no title/workspace heuristic and no hardcoded id. A pin is an exact session id saved by
// the operator under the `default` profile; before use it is validated against that exact profile
// and id. Anything that does not match exactly is stale and fails safely. Both pin slots (`main`,
// `pinned`) resolve the same way.

import { HermesSession, isAuthError, isNotFoundError } from './hermesApi';
import type { PinnedChatReference } from './storage';

export const PINNED_PROFILE = 'default';

export type PinnedChatResolution =
  | { kind: 'none' }
  | { kind: 'ok'; session: HermesSession }
  | { kind: 'stale' }
  | { kind: 'error'; message: string; authExpired: boolean };

function isDefaultProfile(profile?: string): boolean {
  return (profile?.trim() || PINNED_PROFILE) === PINNED_PROFILE;
}

export async function resolvePinnedChat(
  reference: PinnedChatReference | null,
  fetchDetail: (session: { id: string; profile: string; title?: string }) => Promise<HermesSession>,
): Promise<PinnedChatResolution> {
  if (!reference) return { kind: 'none' };
  try {
    const detail = await fetchDetail({ id: reference.sessionId, profile: PINNED_PROFILE, title: reference.title });
    if (detail.id !== reference.sessionId || !isDefaultProfile(detail.profile)) return { kind: 'stale' };
    return { kind: 'ok', session: { ...detail, profile: PINNED_PROFILE, title: detail.title ?? reference.title } };
  } catch (error) {
    if (isNotFoundError(error)) return { kind: 'stale' };
    return { kind: 'error', message: error instanceof Error ? error.message : 'Could not reach Hermes.', authExpired: isAuthError(error) };
  }
}

export function canPinChat(session: Pick<HermesSession, 'id' | 'profile'> | null): boolean {
  return Boolean(session && session.id && !session.id.startsWith('new-') && isDefaultProfile(session.profile));
}
