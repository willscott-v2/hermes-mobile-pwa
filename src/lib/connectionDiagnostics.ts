export type DiagnosticStepId = 'url' | 'status' | 'auth' | 'login' | 'gateway';
export type DiagnosticState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type ConnectionIssueCode =
  | 'invalid-url'
  | 'wrong-pwa-url'
  | 'unreachable'
  | 'auth-failed'
  | 'password-provider-missing'
  | 'gateway-unavailable'
  | 'unknown';

export interface DiagnosticStep {
  id: DiagnosticStepId;
  state: DiagnosticState;
  message: string;
  detail?: string;
  issue?: ConnectionIssueCode;
}

export function initialDiagnosticSteps(): DiagnosticStep[] {
  return [
    { id: 'url', state: 'pending', message: 'Normalize server URL' },
    { id: 'status', state: 'pending', message: 'Reach dashboard status endpoint' },
    { id: 'auth', state: 'pending', message: 'Discover authentication support' },
    { id: 'login', state: 'pending', message: 'Verify login/session readiness' },
    { id: 'gateway', state: 'pending', message: 'Verify live gateway readiness' },
  ];
}

export function connectionStepLabel(id: DiagnosticStepId): string {
  return {
    url: 'Server URL',
    status: 'Dashboard status',
    auth: 'Authentication',
    login: 'Login/session',
    gateway: 'Live gateway',
  }[id];
}

export function connectionIssueHint(code: ConnectionIssueCode): string {
  return {
    'invalid-url': 'Enter an http:// or https:// URL for your Hermes dashboard or same-origin proxy.',
    'wrong-pwa-url': 'This looks like the PWA shell, not the Hermes dashboard API/proxy URL. Try the /hermes proxy path or the private dashboard URL.',
    unreachable: 'The dashboard did not respond. Check that Hermes is running and reachable from this device/network.',
    'auth-failed': 'Sign-in failed. Re-enter the username/password; the app will not store the password.',
    'password-provider-missing': 'This dashboard did not advertise a password provider. Token mode is experimental and requires dashboard-compatible auth.',
    'gateway-unavailable': 'The dashboard responded, but the live WebSocket gateway was not ready.',
    unknown: 'Connection check failed. Review the URL, auth mode, and private network/VPN connection.',
  }[code];
}

export function setDiagnosticStep(steps: DiagnosticStep[], id: DiagnosticStepId, patch: Partial<DiagnosticStep>): DiagnosticStep[] {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step));
}
