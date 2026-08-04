import { describe, expect, it } from 'vitest';
import { connectionIssueHint, connectionStepLabel, initialDiagnosticSteps } from './connectionDiagnostics';

describe('connection diagnostics helpers', () => {
  it('creates the default ordered diagnostics checklist', () => {
    expect(initialDiagnosticSteps().map((step) => step.id)).toEqual(['url', 'status', 'auth', 'login', 'gateway']);
  });

  it('labels common failure hints without exposing secrets', () => {
    expect(connectionIssueHint('wrong-pwa-url')).toContain('dashboard API');
    expect(connectionIssueHint('auth-failed')).not.toMatch(/token=|ticket=|secret/i);
  });

  it('has human labels for every known step', () => {
    for (const step of initialDiagnosticSteps()) {
      expect(connectionStepLabel(step.id).length).toBeGreaterThan(4);
    }
  });
});
