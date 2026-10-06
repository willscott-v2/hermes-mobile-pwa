# GitHub Project Tracking

Every user-visible Hermes Mobile PWA improvement should leave a GitHub trail.

## Per-improvement checklist

1. Create or update a GitHub issue in `willscott-v2/hermes-mobile-pwa` describing the feature/fix.
2. Link the local commit or PR in the issue body/comment.
3. Add the issue to the configured GitHub Project when Project auth is available.
4. Record verification commands in the issue before closing or moving to Done.
5. Keep secrets and private Tailnet details out of GitHub issues/PRs.

## Current repository note

This working copy intentionally has no `origin` remote because local history can contain private Tailnet references. Do not push this history. Public publishing must continue to use fresh/sanitized history as described in `PUBLIC_RELEASE_AUDIT.md`.

## Current auth blocker

The local `gh` token currently has `repo`, `workflow`, `gist`, and `read:org`, but not GitHub Projects scopes. To update Projects directly, refresh auth with:

```bash
gh auth refresh -h github.com -s read:project -s project
```

Then list Projects and add/update items with `gh project`.
