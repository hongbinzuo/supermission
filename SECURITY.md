# Security Report

Last reviewed: 2026-05-26

## Findings & Mitigations

### 1. Path Traversal via `--id` flag (FIXED)

**Severity:** High  
**Vector:** `supermission new "goal" --id "../../etc/cron.d/evil"`  
**Impact:** Write files outside `.supermission/` directory  
**Status:** Fixed — `sanitizeId()` now strips `..`, `/`, `\`, and null bytes from user-provided IDs.

### 2. Shell Injection via Validation Commands (MITIGATED)

**Severity:** Medium  
**Vector:** Validation commands run with `shell: true` in `runShell()`  
**Impact:** If a malicious `work.yaml` contains crafted validation commands, they execute with full shell access  
**Mitigation:**

- Validation commands come from the work creator (trusted user)
- `policy.yaml` `validation_allowlist` restricts which commands can run
- Risky commands require explicit `--allow-risky` flag + gate approval
- Commands are redacted in logs to prevent secret leakage

**Recommendation:** Consider switching to `shell: false` with explicit argument splitting for validation commands in a future version.

### 3. Integration API Keys in Plain Text (KNOWN LIMITATION)

**Severity:** Medium  
**Vector:** `.supermission/integrations.yaml` stores API keys for Linear/Jira/GitHub  
**Impact:** Keys visible in git history if committed  
**Mitigation:**

- `.supermission/integrations.yaml` should be added to `.gitignore`
- CLI redacts keys in display output
- Keys are never written to event logs or artifacts

**Recommendation:** Add a `supermission secrets` command that stores keys in OS keychain (macOS Keychain, Linux secret-service) instead of plain files.

### 4. No Rate Limiting on Runner Execution (LOW)

**Severity:** Low  
**Vector:** A pipeline or batch command could spawn unlimited agent processes  
**Impact:** Resource exhaustion, unexpected API costs  
**Mitigation:**

- Pipelines execute stages sequentially (not parallel)
- `timeout_ms` configuration limits individual runner duration
- Cost tracking (`supermission cost`) provides visibility

**Recommendation:** Add a `max_concurrent_runners` config and a `cost_budget` threshold that blocks execution when exceeded.

### 5. Webhook Payload Not Signed (FUTURE RISK)

**Severity:** Low (not yet implemented)  
**Vector:** When webhook notifications are implemented, payloads sent to external URLs have no HMAC signature  
**Impact:** Receiving endpoint cannot verify payload authenticity  
**Recommendation:** Add HMAC-SHA256 signing with a shared secret when webhooks are implemented.

### 6. Lock File Race Condition (LOW)

**Severity:** Low  
**Vector:** Two users check for lock absence simultaneously, both proceed to create lock  
**Impact:** Concurrent mutations on same work record  
**Mitigation:**

- Git merge conflicts surface the issue on push
- Lock files are advisory, not kernel-level locks
- Append-only JSONL files handle concurrent writes gracefully

**Recommendation:** Acceptable for file-based system. The Coordination Index (future) could enforce stronger locking.

### 7. No Input Length Limits on Goal/Acceptance (LOW)

**Severity:** Low  
**Vector:** `supermission new "$(python -c 'print("A"*10000000)')"` creates huge YAML files  
**Impact:** Disk space, slow parsing  
**Recommendation:** Add max length validation (e.g., goal: 1000 chars, acceptance item: 500 chars).

## Comparison with OpenClaw CVEs

| OpenClaw CVE                                 | Applicable to Supermission?                        | Status                        |
| -------------------------------------------- | -------------------------------------------------- | ----------------------------- |
| CVE-2026-26972 (path traversal in downloads) | No — Supermission has no download/browser features | N/A                           |
| CVE-2026-43567 (outPath traversal)           | Similar risk in `--id` flag                        | Fixed                         |
| CVE-2026-26321 (file exfiltration via media) | No — no media/file serving to external parties     | N/A                           |
| CVE-2026-25253 (RCE via malicious link)      | No — no URL handling or web content rendering      | N/A                           |
| CVE-2026-43533 (path traversal via QQBot)    | No — no chat/bot integration                       | N/A                           |
| GHSA-jjgj-cpp9-cvpv (MCP tool injection)     | Partially — runner prompts could be manipulated    | Mitigated by validation gates |
| SSRF via webhook                             | Future risk when webhooks are implemented          | Noted                         |

## Security Best Practices Applied

- ✅ Secret redaction in all artifacts (redaction.ts)
- ✅ Validation command allowlist (policy.yaml)
- ✅ Risky command blocking with explicit gate
- ✅ No secrets in git (CC Switch creates temp CODEX_HOME)
- ✅ Path sanitization on user-provided IDs
- ✅ Append-only event logs (tamper-evident via git)
- ✅ Runner timeout enforcement
- ✅ No external network calls without explicit user configuration

## Recommendations for Next Release

1. Add `.supermission/integrations.yaml` to default `.gitignore` template
2. Add input length limits on all user-provided strings
3. Consider OS keychain for API key storage
4. Add HMAC signing for future webhook payloads
5. Add `cost_budget` threshold to prevent runaway agent costs
6. Audit all `join()` calls to ensure no unsanitized user input reaches filesystem paths
