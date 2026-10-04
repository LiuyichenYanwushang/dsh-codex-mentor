# Native Team options patch

[native-team-options.json](./native-team-options.json) is an opt-in patch for the native `@deepseek-ai/dsh-experimental-agent-team@0.2.0-rc.2` package, not an extra or standing plugin. It adds the readonly `supportsAgentOptions === true` getter and optional `spawnTeammate` `agentOptions`, `persona`, `toolFilter`, and `childId`, with detached mutable request snapshots, native continuation forwarding, and a duplicate roster-ID guard. Omitting options preserves native defaults.

The pristine input comes from the public npm registry via `npm pack --ignore-scripts --registry=https://registry.npmjs.org/ @deepseek-ai/dsh-experimental-agent-team@0.2.0-rc.2`, extracted into a new temporary directory. No install scripts are needed. The manifest contains seven package-relative paths and twenty-one unique, padded substring replacements; applying each file's replacements in order was verified to reproduce the modified native files byte-for-byte.

Use the separately supplied opt-in applicator only on an explicitly chosen package installation. Require the exact package name/version and each full-file `beforeSha256` before replacing anything, require exactly one match per replacement, and verify `afterSha256` before writing. Files already matching `afterSha256` need no change; reject other contents rather than guessing or bypassing guards. Reinstallation can remove the patch; another version needs its own freshly verified manifest.

A fresh runtime process or full restart is required after an intentional application: loaded modules are not retroactively patched. This artifact does not restart, deploy, modify a profile, or install another plugin.

## Public upstream attribution

Derived from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), published under the MIT License. Preserve the upstream notice when redistributing these excerpts:

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
