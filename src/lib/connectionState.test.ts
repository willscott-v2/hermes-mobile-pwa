import { describe, expect, it } from 'vitest';
import { deriveConnectionView, type ConnectionFacts } from './connectionState';

describe('deriveConnectionView', () => {
  it('reachable but not authenticated reads as reachable-signed-out, not ready', () => {
    const view = deriveConnectionView({ reachable: true });
    expect(view.phase).toBe('reachable-signed-out');
    expect(view.label).toBe('Server reachable');
    expect(view.chatReady).toBe(false);
  });

  it('authenticated but not resumed reads as authenticated, not ready', () => {
    const view = deriveConnectionView({ authenticated: true });
    expect(view.phase).toBe('authenticated');
    expect(view.label).toBe('Signed in');
    expect(view.chatReady).toBe(false);
  });

  it('resumed with open socket and idle reads as ready and chatReady true', () => {
    const view = deriveConnectionView({ resumed: true, socketOpen: true });
    expect(view.phase).toBe('ready');
    expect(view.label).toBe('Ready');
    expect(view.tone).toBe('ok');
    expect(view.chatReady).toBe(true);
  });

  it('resumed and running reads as running, not ready', () => {
    const view = deriveConnectionView({ resumed: true, socketOpen: true, running: true });
    expect(view.phase).toBe('running');
    expect(view.label).toBe('Running');
    expect(view.tone).toBe('busy');
    expect(view.chatReady).toBe(false);
  });

  it('attention overrides running and ready', () => {
    const view = deriveConnectionView({
      resumed: true,
      socketOpen: true,
      running: true,
      attention: true,
    });
    expect(view.phase).toBe('needs-you');
    expect(view.label).toBe('Needs you');
    expect(view.tone).toBe('attention');
    expect(view.chatReady).toBe(false);
  });

  it('resuming reads as restoring', () => {
    const view = deriveConnectionView({ resuming: true });
    expect(view.phase).toBe('restoring');
    expect(view.label).toBe('Restoring…');
    expect(view.tone).toBe('neutral');
    expect(view.chatReady).toBe(false);
  });

  it('socketLost after resumed reads as connection-lost', () => {
    const view = deriveConnectionView({ resumed: true, socketOpen: false, socketLost: true });
    expect(view.phase).toBe('connection-lost');
    expect(view.label).toBe('Connection lost');
    expect(view.tone).toBe('bad');
    expect(view.chatReady).toBe(false);
  });

  it('authExpired beats socketLost', () => {
    const view = deriveConnectionView({ authExpired: true, socketLost: true });
    expect(view.phase).toBe('auth-expired');
    expect(view.label).toBe('Sign in again');
    expect(view.tone).toBe('bad');
  });

  it('checking with nothing else reads as checking', () => {
    const view = deriveConnectionView({ checking: true });
    expect(view.phase).toBe('checking');
    expect(view.label).toBe('Checking…');
    expect(view.tone).toBe('neutral');
    expect(view.chatReady).toBe(false);
  });

  it('empty facts reads as unreachable with chatReady false', () => {
    const view = deriveConnectionView({} satisfies ConnectionFacts);
    expect(view.phase).toBe('unreachable');
    expect(view.label).toBe('Not connected');
    expect(view.tone).toBe('neutral');
    expect(view.chatReady).toBe(false);
  });
});
