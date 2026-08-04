# Onboarding and Composer Controls Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add the two highest-priority Hermex-inspired upgrades to Hermes Mobile PWA: a safer first-run onboarding/connection diagnostics flow and runtime model/profile/project controls in the mobile composer.

**Architecture:** Keep the app static/PWA-first and dashboard-compatible. Split connection/onboarding, connection profiles, and runtime options out of `src/App.tsx` into small typed modules/components while preserving password boundaries: never persist passwords, only safe connection hints and selected runtime options. Use live dashboard endpoint discovery when available, with mock fallbacks so contributors can build and test without a private Hermes server.

**Tech Stack:** React 19, TypeScript strict mode, Vite, Vitest, Playwright mobile emulation, existing Hermes Dashboard REST + `/api/ws` JSON-RPC adapter.

---

## Constraints and non-goals

- Do **not** copy Hermex API assumptions. This PWA targets Hermes Dashboard routes and `/api/ws` JSON-RPC.
- Do **not** persist dashboard passwords.
- Do **not** require a native app, Xcode, iOS Simulator, TestFlight, or App Store flow.
- Keep mock mode first-class; every new UI surface needs mock fixtures/tests.
- Treat token mode as experimental and keep copy clear that `API_SERVER_KEY` is not the dashboard auth token.
- Keep public examples safe: no private Tailnet hostnames, usernames, local macOS paths, secrets, session contents, or tokens in fixtures/docs.

## Acceptance criteria

### Onboarding / connection diagnostics

- First-run flow explains what the app is, what server URL it needs, and why the phone is only the control plane.
- User can choose one of at least three connection paths:
  - Mock demo.
  - Same-origin/private proxy.
  - Custom private dashboard URL.
- “Test connection” runs granular checks and shows readable status for:
  - URL normalization/format.
  - `/api/status` reachability.
  - auth provider/capability discovery.
  - password login readiness when applicable.
  - WebSocket ticket/gateway reachability after auth.
- Error messages distinguish common mistakes:
  - PWA URL used instead of dashboard API/proxy URL.
  - server unreachable.
  - auth failed.
  - dashboard has no password provider.
  - WebSocket/gateway unavailable.
- Existing auto-restore still works and still says password was not stored.
- Automated tests cover diagnostics success/failure and mobile layout.

### Composer runtime controls

- Chat composer has compact runtime chips/selectors for:
  - profile
  - project/workspace, if exposed by the dashboard/session data
  - model/provider, if exposed by dashboard status/catalog endpoints
- Selected runtime options are applied to new sessions and prompt submission where the backend supports them.
- Options degrade gracefully when the backend does not expose catalogs.
- Selections are stored as non-secret local preferences scoped by server URL.
- Mock mode exposes realistic demo options.
- Automated tests prove the controls render, persist, and affect `session.create` / `session.resume` calls where supported.

---

# Phase 1: Onboarding / connection diagnostics

## Task 1: Add typed connection diagnostics model

**Objective:** Define the data shape that all diagnostics UI/tests will use.

**Files:**
- Create: `src/lib/connectionDiagnostics.ts`
- Test: `src/lib/connectionDiagnostics.test.ts`

**Step 1: Write failing tests**

Create `src/lib/connectionDiagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { connectionIssueHint, connectionStepLabel, initialDiagnosticSteps } from './connectionDiagnostics';

describe('connection diagnostics helpers', () => {
  it('creates the default ordered diagnostics checklist', () => {
    expect(initialDiagnosticSteps().map((step) => step.id)).toEqual([
      'url',
      'status',
      'auth',
      'login',
      'gateway',
    ]);
  });

  it('labels common failure hints without exposing secrets', () => {
    expect(connectionIssueHint('wrong-pwa-url')).toContain('dashboard API');
    expect(connectionIssueHint('auth-failed')).not.toMatch(/password|token=|ticket=/i);
  });

  it('has human labels for every known step', () => {
    for (const step of initialDiagnosticSteps()) {
      expect(connectionStepLabel(step.id).length).toBeGreaterThan(4);
    }
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/lib/connectionDiagnostics.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement module**

Create `src/lib/connectionDiagnostics.ts`:

```ts
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
```

**Step 4: Run test to verify pass**

Run:

```bash
npm test -- src/lib/connectionDiagnostics.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/connectionDiagnostics.ts src/lib/connectionDiagnostics.test.ts
git commit -m "feat: add connection diagnostics model"
```

---

## Task 2: Add dashboard endpoint diagnostics to `HermesApiClient`

**Objective:** Provide a reusable client method that tests dashboard connectivity without logging secrets.

**Files:**
- Modify: `src/lib/hermesApi.ts`
- Test: `src/lib/hermesApi.test.ts`

**Step 1: Write failing tests**

Add tests to `src/lib/hermesApi.test.ts`:

```ts
it('diagnoses a healthy password dashboard without persisting a password', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/api/status')) return jsonResponse({ version: 'test', auth_required: true, gateway_running: true });
    if (url.endsWith('/api/auth/providers')) return jsonResponse({ providers: [{ name: 'local', display_name: 'Local', supports_password: true }] });
    if (url.endsWith('/auth/password-login')) return jsonResponse({ ok: true });
    if (url.endsWith('/api/auth/ws-ticket')) return jsonResponse({ ticket: 'ticket-1' });
    return new Response('{}', { status: 404 });
  }));

  const client = new HermesApiClient('https://agent.example/hermes');
  const result = await client.diagnoseConnection({ mode: 'password', username: 'will', password: 'secret' });

  expect(result.ok).toBe(true);
  expect(result.steps.map((step) => step.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(requests.some((url) => url.endsWith('/api/auth/ws-ticket'))).toBe(true);
});

it('diagnoses likely wrong PWA URL when status route returns html', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } })));
  const client = new HermesApiClient('https://agent.example');
  const result = await client.diagnoseConnection({ mode: 'password', username: '', password: '' });
  expect(result.ok).toBe(false);
  expect(result.steps.find((step) => step.id === 'status')?.issue).toBe('wrong-pwa-url');
});
```

If `jsonResponse` helper does not exist in the file, add:

```ts
function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}
```

**Step 2: Run test to verify failure**

```bash
npm test -- src/lib/hermesApi.test.ts
```

Expected: FAIL because `diagnoseConnection` does not exist.

**Step 3: Implement types and method**

In `src/lib/hermesApi.ts`, import diagnostics types and add:

```ts
import { connectionIssueHint, initialDiagnosticSteps, type ConnectionIssueCode, type DiagnosticStep } from './connectionDiagnostics';

export interface ConnectionDiagnosticResult {
  ok: boolean;
  normalizedUrl: string;
  capability?: AuthCapability;
  version?: string;
  steps: DiagnosticStep[];
}

export interface ConnectionDiagnosticInput {
  mode: AuthMode;
  username?: string;
  password?: string;
  token?: string;
}
```

Add helper functions near `parseError`:

```ts
function updateStep(steps: DiagnosticStep[], id: DiagnosticStep['id'], patch: Partial<DiagnosticStep>): DiagnosticStep[] {
  return steps.map((step) => step.id === id ? { ...step, ...patch } : step);
}

function failedResult(baseUrl: string, steps: DiagnosticStep[], id: DiagnosticStep['id'], issue: ConnectionIssueCode, detail?: string): ConnectionDiagnosticResult {
  return {
    ok: false,
    normalizedUrl: baseUrl,
    steps: updateStep(steps, id, { state: 'failed', issue, message: connectionIssueHint(issue), detail }),
  };
}
```

Add method to `HermesApiClient`:

```ts
async diagnoseConnection(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnosticResult> {
  let steps = updateStep(initialDiagnosticSteps(), 'url', { state: 'passed', message: 'URL parsed.' });
  let status: ServerStatus;
  try {
    steps = updateStep(steps, 'status', { state: 'running', message: 'Checking /api/status…' });
    status = await this.status();
    steps = updateStep(steps, 'status', { state: 'passed', message: status.version ? `Dashboard responded (${status.version}).` : 'Dashboard responded.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status check failed.';
    const issue = /doctype|<html|root/i.test(message) ? 'wrong-pwa-url' : 'unreachable';
    return failedResult(this.baseUrl, steps, 'status', issue, message);
  }

  let providers: AuthProvider[] = [];
  try {
    providers = await this.authProviders();
    const capability = this.capability(status, providers);
    steps = updateStep(steps, 'auth', { state: 'passed', message: capability.kind === 'passwordAvailable' ? `Password provider: ${capability.displayName}` : 'Auth capability discovered.' });

    let auth: AuthSession | undefined;
    if (input.mode === 'password' && capability.kind === 'passwordAvailable') {
      steps = updateStep(steps, 'login', { state: 'running', message: 'Checking password login…' });
      auth = await this.passwordLogin(capability.provider, input.username ?? '', input.password ?? '');
      steps = updateStep(steps, 'login', { state: 'passed', message: 'Password login accepted. Password was not stored.' });
    } else if (input.mode === 'password') {
      return failedResult(this.baseUrl, steps, 'auth', 'password-provider-missing');
    } else if (input.mode === 'token') {
      auth = { mode: 'token', token: input.token };
      steps = updateStep(steps, 'login', { state: 'skipped', message: 'Token mode selected; password login skipped.' });
    } else {
      steps = updateStep(steps, 'login', { state: 'skipped', message: 'Mock mode does not use dashboard login.' });
    }

    steps = updateStep(steps, 'gateway', { state: 'running', message: 'Checking WebSocket ticket…' });
    if (auth) await this.wsTicket(auth);
    steps = updateStep(steps, 'gateway', { state: 'passed', message: 'Gateway ticket endpoint responded.' });
    return { ok: true, normalizedUrl: this.baseUrl, capability, version: status.version, steps };
  } catch (error) {
    const detail = error instanceof Error ? redactForLog(error.message) : undefined;
    const active = steps.find((step) => step.state === 'running')?.id ?? 'login';
    return failedResult(this.baseUrl, steps, active, active === 'gateway' ? 'gateway-unavailable' : 'auth-failed', detail);
  }
}
```

**Step 4: Run focused tests**

```bash
npm test -- src/lib/hermesApi.test.ts src/lib/connectionDiagnostics.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/hermesApi.ts src/lib/hermesApi.test.ts src/lib/connectionDiagnostics.ts src/lib/connectionDiagnostics.test.ts
git commit -m "feat: diagnose dashboard connections"
```

---

## Task 3: Extract onboarding screen component

**Objective:** Move the connection form into a purpose-built onboarding component so the flow can grow without making `App.tsx` harder to maintain.

**Files:**
- Create: `src/components/ConnectOnboarding.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `tests/e2e/mobile-layout.spec.ts`

**Step 1: Write failing e2e assertion**

In `tests/e2e/mobile-layout.spec.ts`, add to the connect-screen test:

```ts
await expect(page.getByText('Choose how to connect')).toBeVisible();
await expect(page.getByText('Mock demo')).toBeVisible();
await expect(page.getByText('Private dashboard')).toBeVisible();
await expect(page.getByText('Passwords are never persisted')).toBeVisible();
```

**Step 2: Run test to verify failure**

```bash
npm run test:e2e -- tests/e2e/mobile-layout.spec.ts
```

Expected: FAIL because the copy is not present.

**Step 3: Create component**

Create `src/components/ConnectOnboarding.tsx` with props copied from the current inline JSX:

```tsx
import { Bot, CircleAlert, ShieldCheck } from 'lucide-react';
import type { FormEvent } from 'react';
import type { AuthMode, AuthCapability } from '../lib/hermesApi';
import type { ConnStatus } from '../lib/uiTypes';

export interface ConnectionStateView {
  rawUrl: string;
  mode: AuthMode;
  username: string;
  password: string;
  token: string;
  rememberToken: boolean;
  status: ConnStatus;
  message: string;
  capability?: AuthCapability;
  version?: string;
}

interface Props {
  connection: ConnectionStateView;
  onChange(next: Partial<ConnectionStateView>): void;
  onCheck(): void;
  onSubmit(event: FormEvent): void;
}

export function ConnectOnboarding({ connection, onChange, onCheck, onSubmit }: Props) {
  return (
    <section className="connect-card onboarding-card">
      <div className="hero-orb"><Bot size={44} /></div>
      <h2>Your agent, pocket-sized.</h2>
      <p>Hermes runs on your machine. This PWA is just the phone control surface.</p>
      <div className="onboarding-steps" aria-label="Connection options">
        <strong>Choose how to connect</strong>
        <span>Mock demo — no server or credentials.</span>
        <span>Private dashboard — same-origin proxy or Tailnet URL.</span>
        <span>Custom URL — advanced private deployments.</span>
      </div>
      <form onSubmit={onSubmit} className="stack">
        {/* Move the existing mode/url/username/password/token fields here unchanged. */}
      </form>
      <div className="security-note"><ShieldCheck size={16} /> Passwords are never persisted. Use Tailscale/VPN; do not expose Hermes publicly.</div>
    </section>
  );
}
```

During implementation, fill the form body with the current JSX from `App.tsx` lines 434-449 and replace each `setConnection` call with `onChange`.

**Step 4: Move shared UI types if needed**

Create `src/lib/uiTypes.ts`:

```ts
export type ConnStatus = 'idle' | 'checking' | 'ready' | 'connecting' | 'error';
```

Update `App.tsx` to import `ConnStatus` from `./lib/uiTypes` and remove its local definition.

**Step 5: Replace inline JSX in `App.tsx`**

In `App.tsx`, replace the connect screen section with:

```tsx
{screen === 'connect' && (
  <ConnectOnboarding
    connection={connection}
    onChange={(patch) => setConnection((state) => ({ ...state, ...patch }))}
    onCheck={checkServer}
    onSubmit={connect}
  />
)}
```

**Step 6: Style the onboarding choices**

Add to `src/styles.css`:

```css
.onboarding-card > p {
  margin-bottom: 0.75rem;
}

.onboarding-steps {
  display: grid;
  gap: 0.45rem;
  padding: 0.8rem;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  background: rgba(255,255,255,0.045);
  color: var(--muted);
  font-size: 0.9rem;
}

.onboarding-steps strong {
  color: var(--text);
}
```

**Step 7: Run verification**

```bash
npm run typecheck && npm run test:e2e -- tests/e2e/mobile-layout.spec.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/App.tsx src/components/ConnectOnboarding.tsx src/lib/uiTypes.ts src/styles.css tests/e2e/mobile-layout.spec.ts
git commit -m "feat: add first-run connection onboarding"
```

---

## Task 4: Render granular diagnostics checklist in onboarding

**Objective:** Show the user exactly which connection step passed/failed.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ConnectOnboarding.tsx`
- Modify: `src/styles.css`
- Test: `tests/e2e/mobile-layout.spec.ts`

**Step 1: Add state to `App.tsx`**

Import:

```ts
import { initialDiagnosticSteps, type DiagnosticStep } from './lib/connectionDiagnostics';
```

Add state:

```ts
const [diagnosticSteps, setDiagnosticSteps] = useState<DiagnosticStep[]>(initialDiagnosticSteps);
```

**Step 2: Wire `checkServer` to `diagnoseConnection`**

Update the live branch of `checkServer` to call:

```ts
const result = await api.diagnoseConnection({
  mode: connection.mode,
  username: connection.username,
  password: connection.password,
  token: connection.token,
});
setDiagnosticSteps(result.steps);
```

Then set `connection.message` from `result.ok` and failed step details.

Mock branch should set all steps to passed/skipped with safe mock messages.

**Step 3: Render steps**

Add prop to `ConnectOnboarding`:

```ts
diagnostics: DiagnosticStep[];
```

Render under buttons:

```tsx
<ol className="diagnostics-list" aria-label="Connection diagnostics">
  {diagnostics.map((step) => (
    <li key={step.id} data-state={step.state}>
      <span>{connectionStepLabel(step.id)}</span>
      <small>{step.message}</small>
    </li>
  ))}
</ol>
```

Import `connectionStepLabel`.

**Step 4: Style steps**

```css
.diagnostics-list {
  display: grid;
  gap: 0.45rem;
  padding: 0;
  margin: 0.75rem 0 0;
  list-style: none;
}

.diagnostics-list li {
  display: grid;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  border-radius: 14px;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.07);
}

.diagnostics-list li[data-state='passed'] { border-color: rgba(145,195,100,0.45); }
.diagnostics-list li[data-state='failed'] { border-color: rgba(223,89,38,0.6); }
.diagnostics-list li[data-state='running'] { border-color: rgba(78,177,205,0.5); }
.diagnostics-list small { color: var(--muted); }
```

**Step 5: Test**

Add e2e checks that clicking “Check server” in mock mode shows passed diagnostics:

```ts
await page.getByLabel('Mode').selectOption('mock');
await page.getByRole('button', { name: /enable mock/i }).click();
await expect(page.getByLabel('Connection diagnostics')).toContainText('Server URL');
await expect(page.getByLabel('Connection diagnostics')).toContainText('Mock mode');
```

Run:

```bash
npm run typecheck && npm run test:e2e -- tests/e2e/mobile-layout.spec.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/components/ConnectOnboarding.tsx src/styles.css tests/e2e/mobile-layout.spec.ts
git commit -m "feat: show connection diagnostics checklist"
```

---

## Task 5: Add saved server profiles without passwords

**Objective:** Let users keep safe connection profiles while preserving password boundaries.

**Files:**
- Modify: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`
- Modify: `src/components/ConnectOnboarding.tsx`
- Modify: `src/App.tsx`

**Step 1: Create storage tests**

Create `src/lib/storage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConnectionProfiles, saveConnectionProfile } from './storage';

describe('connection profile storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('stores safe server profile metadata without passwords or tokens', () => {
    saveConnectionProfile({ name: 'Local demo', url: 'https://agent.example/hermes', mode: 'password', username: 'will', password: 'secret', token: 'abc' } as never);
    const raw = JSON.stringify(loadConnectionProfiles());
    expect(raw).toContain('Local demo');
    expect(raw).toContain('https://agent.example/hermes');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('abc');
  });
});
```

**Step 2: Implement storage APIs**

In `src/lib/storage.ts`:

```ts
const CONNECTION_PROFILES_KEY = 'hermes-mobile-pwa.connection-profiles.v1';

export interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
  mode: AuthMode;
  username?: string;
  lastUsedAt?: string;
}

export function loadConnectionProfiles(): ConnectionProfile[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONNECTION_PROFILES_KEY) ?? '{}') as { profiles?: ConnectionProfile[] };
    return Array.isArray(parsed.profiles) ? parsed.profiles.filter((profile) => profile.id && profile.url) : [];
  } catch {
    return [];
  }
}

export function saveConnectionProfile(input: Omit<ConnectionProfile, 'id' | 'lastUsedAt'> & { id?: string; password?: string; token?: string }): ConnectionProfile {
  const profiles = loadConnectionProfiles();
  const id = input.id || crypto.randomUUID();
  const profile: ConnectionProfile = {
    id,
    name: input.name.trim() || new URL(input.url).hostname,
    url: input.url,
    mode: input.mode,
    username: input.username?.trim() || undefined,
    lastUsedAt: new Date().toISOString(),
  };
  const next = [profile, ...profiles.filter((seen) => seen.id !== id && seen.url !== profile.url)].slice(0, 8);
  window.localStorage.setItem(CONNECTION_PROFILES_KEY, JSON.stringify({ profiles: next }));
  return profile;
}

export function deleteConnectionProfile(id: string): void {
  const next = loadConnectionProfiles().filter((profile) => profile.id !== id);
  window.localStorage.setItem(CONNECTION_PROFILES_KEY, JSON.stringify({ profiles: next }));
}
```

**Step 3: Add UI selector**

In `App.tsx`, load profiles:

```ts
const [connectionProfiles, setConnectionProfiles] = useState(loadConnectionProfiles);
```

After successful connect, save/update profile:

```ts
const savedProfile = saveConnectionProfile({
  name: new URL(normalized).hostname,
  url: normalized,
  mode: connection.mode,
  username: connection.username,
});
setConnectionProfiles(loadConnectionProfiles());
```

In `ConnectOnboarding`, render a select when profiles exist:

```tsx
{profiles.length > 0 && (
  <label>
    <span>Saved connection</span>
    <select onChange={(event) => onSelectProfile(event.target.value)} defaultValue="">
      <option value="">Choose saved server…</option>
      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select>
  </label>
)}
```

**Step 4: Verify**

```bash
npm test -- src/lib/storage.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts src/App.tsx src/components/ConnectOnboarding.tsx
git commit -m "feat: remember safe connection profiles"
```

---

# Phase 2: Composer model/profile/project controls

## Task 6: Add runtime option types and persistence

**Objective:** Define a backend-agnostic runtime selection model.

**Files:**
- Create: `src/lib/runtimeOptions.ts`
- Modify: `src/lib/storage.ts`
- Test: `src/lib/runtimeOptions.test.ts`

**Step 1: Write failing test**

Create `src/lib/runtimeOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeRuntimeCatalog, sanitizeRuntimeSelection } from './runtimeOptions';

describe('runtime options', () => {
  it('dedupes and labels catalog values', () => {
    const catalog = normalizeRuntimeCatalog({
      profiles: ['default', 'default', 'sales'],
      projects: [{ id: 'p1', name: 'Mobile PWA' }],
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
    });
    expect(catalog.profiles).toEqual([{ id: 'default', label: 'default' }, { id: 'sales', label: 'sales' }]);
    expect(catalog.projects[0].label).toBe('Mobile PWA');
  });

  it('drops selections not present in the catalog', () => {
    const selection = sanitizeRuntimeSelection({ profile: 'missing', projectId: 'p1', model: 'm1' }, normalizeRuntimeCatalog({ projects: [{ id: 'p1', name: 'P1' }] }));
    expect(selection).toEqual({ projectId: 'p1' });
  });
});
```

**Step 2: Implement module**

Create `src/lib/runtimeOptions.ts`:

```ts
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

type RawOption = string | { id?: string; name?: string; label?: string; value?: string };

function normalizeOptions(values?: RawOption[]): RuntimeOption[] {
  const seen = new Set<string>();
  const options: RuntimeOption[] = [];
  for (const value of values ?? []) {
    const id = typeof value === 'string' ? value : value.id ?? value.value ?? value.name ?? '';
    const label = typeof value === 'string' ? value : value.label ?? value.name ?? id;
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
```

**Step 3: Add persistence**

In `src/lib/storage.ts`:

```ts
import type { RuntimeSelection } from './runtimeOptions';

const RUNTIME_SELECTION_KEY = 'hermes-mobile-pwa.runtime-selection.v1';

export function loadRuntimeSelection(serverUrl: string): RuntimeSelection {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RUNTIME_SELECTION_KEY) ?? '{}') as Record<string, RuntimeSelection>;
    return parsed[serverUrl] ?? {};
  } catch {
    return {};
  }
}

export function saveRuntimeSelection(serverUrl: string, selection: RuntimeSelection): void {
  let parsed: Record<string, RuntimeSelection> = {};
  try { parsed = JSON.parse(window.localStorage.getItem(RUNTIME_SELECTION_KEY) ?? '{}') as Record<string, RuntimeSelection>; } catch {}
  parsed[serverUrl] = selection;
  window.localStorage.setItem(RUNTIME_SELECTION_KEY, JSON.stringify(parsed));
}
```

**Step 4: Run tests**

```bash
npm test -- src/lib/runtimeOptions.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/runtimeOptions.ts src/lib/runtimeOptions.test.ts src/lib/storage.ts
git commit -m "feat: add runtime option model"
```

---

## Task 7: Discover runtime catalog from dashboard safely

**Objective:** Add best-effort API calls to collect profile/project/model options without breaking older dashboards.

**Files:**
- Modify: `src/lib/hermesApi.ts`
- Test: `src/lib/hermesApi.test.ts`
- Modify: `src/lib/mockHermes.ts`

**Step 1: Write failing test**

Add to `src/lib/hermesApi.test.ts`:

```ts
it('loads runtime catalog from optional dashboard endpoints', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/profiles')) return jsonResponse({ profiles: ['default', 'research'] });
    if (url.endsWith('/api/projects')) return jsonResponse({ projects: [{ id: 'pwa', name: 'PWA' }] });
    if (url.endsWith('/api/models')) return jsonResponse({ models: [{ id: 'm1', label: 'Model 1' }] });
    return new Response('{}', { status: 404 });
  }));

  const catalog = await new HermesApiClient('https://agent.example/hermes').runtimeCatalog({ mode: 'password' });
  expect(catalog.profiles.map((profile) => profile.id)).toContain('research');
  expect(catalog.projects[0]).toEqual({ id: 'pwa', label: 'PWA' });
  expect(catalog.models[0]).toEqual({ id: 'm1', label: 'Model 1' });
});

it('returns an empty runtime catalog when optional endpoints are absent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  const catalog = await new HermesApiClient('https://agent.example/hermes').runtimeCatalog({ mode: 'password' });
  expect(catalog).toEqual({ profiles: [], projects: [], models: [] });
});
```

**Step 2: Implement method**

In `src/lib/hermesApi.ts`, import:

```ts
import { normalizeRuntimeCatalog, type RuntimeCatalog } from './runtimeOptions';
```

Add helper:

```ts
async function optionalGet<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
```

Add method:

```ts
async runtimeCatalog(auth: AuthSession): Promise<RuntimeCatalog> {
  const [profiles, projects, models] = await Promise.all([
    optionalGet(() => this.get<{ profiles?: unknown[] } | unknown[]>('/api/profiles', auth), []),
    optionalGet(() => this.get<{ projects?: unknown[] } | unknown[]>('/api/projects', auth), []),
    optionalGet(() => this.get<{ models?: unknown[] } | unknown[]>('/api/models', auth), []),
  ]);
  return normalizeRuntimeCatalog({
    profiles: Array.isArray(profiles) ? profiles as never[] : (profiles as { profiles?: never[] }).profiles,
    projects: Array.isArray(projects) ? projects as never[] : (projects as { projects?: never[] }).projects,
    models: Array.isArray(models) ? models as never[] : (models as { models?: never[] }).models,
  });
}
```

If actual dashboard endpoint names differ after live inspection, update tests and method to match real routes. Keep optional failure behavior.

**Step 3: Add mock catalog**

In `src/lib/mockHermes.ts`:

```ts
async runtimeCatalog() {
  return {
    profiles: [{ id: 'default', label: 'default' }, { id: 'research', label: 'research' }],
    projects: [{ id: 'mobile-pwa', label: 'Hermes Mobile PWA' }],
    models: [{ id: 'default', label: 'Default model' }, { id: 'fast', label: 'Fast mock model' }],
  };
}
```

**Step 4: Verify**

```bash
npm test -- src/lib/hermesApi.test.ts src/lib/runtimeOptions.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/hermesApi.ts src/lib/hermesApi.test.ts src/lib/mockHermes.ts
git commit -m "feat: discover runtime option catalog"
```

---

## Task 8: Add compact runtime controls component

**Objective:** Render mobile-friendly profile/project/model chips above the composer.

**Files:**
- Create: `src/components/RuntimeControls.tsx`
- Modify: `src/styles.css`
- Test: `tests/e2e/mobile-layout.spec.ts`

**Step 1: Write failing e2e test**

In mock chat setup, assert controls exist:

```ts
await expect(page.getByLabel('Runtime controls')).toBeVisible();
await expect(page.getByLabel('Profile')).toBeVisible();
await expect(page.getByLabel('Project')).toBeVisible();
await expect(page.getByLabel('Model')).toBeVisible();
```

**Step 2: Create component**

Create `src/components/RuntimeControls.tsx`:

```tsx
import type { RuntimeCatalog, RuntimeSelection } from '../lib/runtimeOptions';

interface Props {
  catalog: RuntimeCatalog;
  selection: RuntimeSelection;
  disabled?: boolean;
  onChange(selection: RuntimeSelection): void;
}

export function RuntimeControls({ catalog, selection, disabled, onChange }: Props) {
  if (!catalog.profiles.length && !catalog.projects.length && !catalog.models.length) return null;
  return (
    <div className="runtime-controls" aria-label="Runtime controls">
      <RuntimeSelect
        label="Profile"
        value={selection.profile ?? ''}
        options={catalog.profiles}
        disabled={disabled || !catalog.profiles.length}
        onChange={(profile) => onChange({ ...selection, profile: profile || undefined })}
      />
      <RuntimeSelect
        label="Project"
        value={selection.projectId ?? ''}
        options={catalog.projects}
        disabled={disabled || !catalog.projects.length}
        onChange={(projectId) => onChange({ ...selection, projectId: projectId || undefined })}
      />
      <RuntimeSelect
        label="Model"
        value={selection.model ?? ''}
        options={catalog.models}
        disabled={disabled || !catalog.models.length}
        onChange={(model) => onChange({ ...selection, model: model || undefined })}
      />
    </div>
  );
}

function RuntimeSelect({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="runtime-chip">
      <span>{label}</span>
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Auto</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
```

**Step 3: Style**

Add to `src/styles.css`:

```css
.runtime-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
  padding: 0.4rem;
  border-radius: 18px;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.07);
}

.runtime-chip {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.runtime-chip span {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 0.06em;
}

.runtime-chip select {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 12px;
  background: rgba(0,0,0,0.18);
  color: var(--text);
  padding: 0.45rem 0.35rem;
  font-size: 0.78rem;
}
```

**Step 4: Verify focused component by temporarily rendering in App in next task**

Do not commit e2e test until Task 9 wires the component.

---

## Task 9: Wire runtime controls into chat creation/resume

**Objective:** Load runtime catalog after connection, render controls, persist selection, and pass profile where already supported.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/hermesApi.ts`
- Test: `src/lib/hermesApi.test.ts`
- Test: `tests/e2e/mobile-layout.spec.ts`

**Step 1: Add state**

In `App.tsx`:

```ts
const [runtimeCatalog, setRuntimeCatalog] = useState<RuntimeCatalog>({ profiles: [], projects: [], models: [] });
const [runtimeSelection, setRuntimeSelection] = useState<RuntimeSelection>({});
```

Import `RuntimeControls`, runtime types, and storage functions.

**Step 2: Load catalog after connect/restore**

After setting `client` and `auth`, call:

```ts
const catalog = 'runtimeCatalog' in api ? await api.runtimeCatalog(restoredAuth) : { profiles: [], projects: [], models: [] };
setRuntimeCatalog(catalog);
setRuntimeSelection(sanitizeRuntimeSelection(loadRuntimeSelection(api.baseUrl), catalog));
```

Do this in both auto-restore and explicit `connect` paths. Mock client should work because Task 7 adds `runtimeCatalog`.

**Step 3: Render above composer**

In the composer form, before the attachment tray:

```tsx
<RuntimeControls
  catalog={runtimeCatalog}
  selection={runtimeSelection}
  disabled={chatStatus === 'connecting' || chatStatus === 'running'}
  onChange={(next) => {
    const safe = sanitizeRuntimeSelection(next, runtimeCatalog);
    setRuntimeSelection(safe);
    if (client && 'baseUrl' in client) saveRuntimeSelection(client.baseUrl, safe);
  }}
/>
```

**Step 4: Pass profile to session create/resume**

Change:

```ts
const id = await gateway.createSession();
```

to:

```ts
const id = await gateway.createSession(runtimeSelection.profile);
```

For resume, prefer explicit current selection over session profile:

```ts
const liveSessionId = await gateway.resumeSession(resumeTarget.id, runtimeSelection.profile ?? resumeTarget.profile);
```

**Step 5: Plan model/project transport separately**

Do not invent JSON-RPC params. For this task, profile is the only existing typed argument in `GatewayHandle`. Model/project controls persist and render, but they should be sent only after Task 10 verifies backend method shapes.

**Step 6: Verify**

```bash
npm run typecheck
npm test -- src/lib/runtimeOptions.test.ts src/lib/hermesApi.test.ts
npm run test:e2e -- tests/e2e/mobile-layout.spec.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/App.tsx src/components/RuntimeControls.tsx src/lib/storage.ts src/lib/hermesApi.ts src/lib/mockHermes.ts tests/e2e/mobile-layout.spec.ts
git commit -m "feat: add composer runtime controls"
```

---

## Task 10: Verify and implement model/project submission transport

**Objective:** Only after live/dashboard source inspection, pass model/project selections to Hermes in the route-compatible shape.

**Files:**
- Modify: `src/lib/hermesApi.ts`
- Modify: `src/lib/hermesApi.test.ts`
- Modify: `src/lib/mockHermes.ts`
- Possibly modify: `src/App.tsx`

**Step 1: Inspect authoritative backend shape**

From the public Hermes Agent docs/source or local dashboard routes, verify whether runtime selection belongs in one of:

- `session.create` params
- `session.resume` params
- `prompt.submit` params
- separate model/profile/project JSON-RPC methods
- REST settings endpoints

Record findings in `docs/ARCHITECTURE.md` or a short note under this plan before implementing.

**Step 2: Write failing tests for the verified shape**

Example if `prompt.submit` supports model/project:

```ts
it('passes verified runtime options with prompt.submit', async () => {
  const sent: string[] = [];
  // existing mock WebSocket setup
  // submit prompt with runtime selection
  expect(sent.join('\n')).toContain('"model":"m1"');
  expect(sent.join('\n')).toContain('"project_id":"pwa"');
});
```

If model/project is not supported, write a test that proves controls do **not** send unsupported params and show “applies to future supported backends” helper text.

**Step 3: Implement minimal transport**

Update interfaces only for verified params. Example:

```ts
export interface PromptSubmitOptions {
  model?: string;
  projectId?: string;
}

submitPrompt(sessionId: string, prompt: string, options?: PromptSubmitOptions): Promise<void>;
```

Then map field names exactly as backend expects.

**Step 4: Verify against tests and live mock**

```bash
npm run typecheck
npm test
npm run test:e2e
```

**Step 5: Commit**

```bash
git add src/lib/hermesApi.ts src/lib/hermesApi.test.ts src/lib/mockHermes.ts src/App.tsx docs/ARCHITECTURE.md
git commit -m "feat: apply verified runtime selections"
```

---

## Task 11: Mobile visual QA and docs update

**Objective:** Prove the two upgrades work on mobile screenshots and document them for contributors/users.

**Files:**
- Modify: `README.md`
- Modify: `docs/AUTH_SETUP.md`
- Modify: `docs/ARCHITECTURE.md`
- Possibly update screenshots: `docs/images/*.png`

**Step 1: Update docs**

README “What works today” should add:

```md
- **Guided onboarding and diagnostics** for common private dashboard connection problems.
- **Composer runtime controls** for supported profile/project/model selection.
```

`docs/AUTH_SETUP.md` should mention the diagnostics checklist and wrong-base-URL guidance.

`docs/ARCHITECTURE.md` should describe runtime option discovery and which options are transported vs UI-only.

**Step 2: Generate screenshots**

```bash
npm run qa:mobile
```

Inspect:

```text
test-results/manual-mobile-ux/01-connect.png
test-results/manual-mobile-ux/03-chat.png
```

If safe/public, copy updated versions:

```bash
cp test-results/manual-mobile-ux/01-connect.png docs/images/mobile-connect.png
cp test-results/manual-mobile-ux/03-chat.png docs/images/mobile-chat.png
```

**Step 3: Full gate**

```bash
npm run typecheck \
  && npm test \
  && npm run build \
  && npm run smoke \
  && npm run scan:secrets \
  && npm run test:e2e \
  && npm run qa:mobile
```

Expected: all pass.

**Step 4: Commit and push**

```bash
git add README.md docs/AUTH_SETUP.md docs/ARCHITECTURE.md docs/images src tests
npm run scan:secrets
git commit -m "docs: document onboarding and runtime controls"
git push origin main
```

---

## Implementation notes from Hermex review

Hermex inspired the priorities, but direct compatibility failed because it targets a different backend API shape. Relevant Hermex ideas to borrow without copying its API:

- Treat the phone as a control plane, not compute plane.
- Make connection setup explicit, especially HTTPS/Tailscale/private-server guidance.
- Store auth/server metadata safely in native/PWA storage while avoiding password persistence.
- Put runtime choices close to the composer instead of burying them in settings.
- Degrade gracefully when the backend does not advertise optional controls.

## Final verification before release

Run from the canonical public clone:

```bash
cd hermes-mobile-pwa
npm run typecheck \
  && npm test \
  && npm run build \
  && npm run smoke \
  && npm run scan:secrets \
  && npm run test:e2e \
  && npm run qa:mobile
```

Then verify public repo state:

```bash
git status --short --branch
git log --oneline -5
gh repo view willscott-v2/hermes-mobile-pwa --json url,visibility,defaultBranchRef
```
