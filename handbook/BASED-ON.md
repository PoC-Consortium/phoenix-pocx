# Handbook source revision

This file records the exact wallet revision the handbook content reflects. Keep
it accurate: it is the anchor that makes future updates a *delta* (diff the app
between this commit and the new HEAD) instead of a full re-read.

| Field            | Value                                      |
|------------------|--------------------------------------------|
| Based-on commit  | `9e4854c1bb406d18041852a72cac89ab45a06017` |
| Short SHA        | `9e4854c`                                   |
| App version      | `2.0.3`                                      |
| Synced on        | 2026-06-22                                   |

## How to update the handbook against a newer wallet

1. Note the new target: `git rev-parse HEAD` (and the app version in
   `web-wallet/package.json`).
2. Diff the wallet's user-facing surface between the based-on commit and the
   target, e.g.:

   ```sh
   git log --oneline 9e4854c..HEAD
   git diff 9e4854c..HEAD -- web-wallet/src/assets/locales/en.json
   git diff 9e4854c..HEAD -- web-wallet/src/app
   ```

   `en.json` is the fastest signal: added/changed keys map almost one-to-one to
   user-visible label, hint, and feature changes.
3. Apply the documentation deltas to the affected chapters, retake any
   screenshots whose UI changed, and bump `metadata.yaml`'s `date:`.
4. Update the table above to the new commit, SHA, version, and date.

## History

| Synced on  | Based-on  | Version | Notes                                              |
|------------|-----------|---------|----------------------------------------------------|
| 2026-06-22 | `9e4854c` | 2.0.3   | First recorded revision. See `UPDATE-NOTES-2026-06.md`. |
| (original) | `4c48855` | 2.0     | Initial handbook authoring (no revision was recorded). |
