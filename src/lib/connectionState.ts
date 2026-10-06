export type ConnectionPhase =
  | 'checking'
  | 'unreachable'
  | 'reachable-signed-out'
  | 'authenticated'
  | 'restoring'
  | 'ready'
  | 'running'
  | 'needs-you'
  | 'connection-lost'
  | 'auth-expired'
  | 'error';

export interface ConnectionFacts {
  checking?: boolean;
  reachable?: boolean;
  authenticated?: boolean;
  authExpired?: boolean;
  socketOpen?: boolean;
  socketLost?: boolean;
  resuming?: boolean;
  resumed?: boolean;
  running?: boolean;
  attention?: boolean;
  error?: boolean;
}

export interface ConnectionView {
  phase: ConnectionPhase;
  label: string;
  tone: 'neutral' | 'ok' | 'busy' | 'attention' | 'bad';
  chatReady: boolean;
}

export function deriveConnectionView(facts: ConnectionFacts): ConnectionView {
  let phase: ConnectionPhase;
  let label: string;
  let tone: ConnectionView['tone'];

  if (facts.error) {
    phase = 'error';
    label = 'Error';
    tone = 'bad';
  } else if (facts.authExpired) {
    phase = 'auth-expired';
    label = 'Sign in again';
    tone = 'bad';
  } else if (facts.socketLost) {
    phase = 'connection-lost';
    label = 'Connection lost';
    tone = 'bad';
  } else if (facts.attention) {
    phase = 'needs-you';
    label = 'Needs you';
    tone = 'attention';
  } else if (facts.running && facts.resumed) {
    phase = 'running';
    label = 'Running';
    tone = 'busy';
  } else if (facts.resuming) {
    phase = 'restoring';
    label = 'Restoring…';
    tone = 'neutral';
  } else if (facts.resumed && facts.socketOpen) {
    phase = 'ready';
    label = 'Ready';
    tone = 'ok';
  } else if (facts.authenticated) {
    phase = 'authenticated';
    label = 'Signed in';
    tone = 'ok';
  } else if (facts.reachable) {
    phase = 'reachable-signed-out';
    label = 'Server reachable';
    tone = 'neutral';
  } else if (facts.checking) {
    phase = 'checking';
    label = 'Checking…';
    tone = 'neutral';
  } else {
    phase = 'unreachable';
    label = 'Not connected';
    tone = 'neutral';
  }

  return {
    phase,
    label,
    tone,
    chatReady: phase === 'ready',
  };
}
