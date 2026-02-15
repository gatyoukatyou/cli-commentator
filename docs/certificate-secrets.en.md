<a href="certificate-secrets.ja.md"><kbd>日本語</kbd></a>
<a href="certificate-secrets.en.md"><kbd>English</kbd></a>

# Certificate & Secrets Operations Guide (v1)

This guide defines the standard operations for certificates and secrets used in desktop signing/notarization.

## 1. Managed secrets

| Secret | Purpose | Required |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater artifact signing key | Required |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater signing-key password | Required |
| `APPLE_CERTIFICATE` | base64-encoded macOS `.p12` signing certificate | Required |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password | Required |
| `KEYCHAIN_PASSWORD` | Temporary CI keychain protection | Required |
| `APPLE_ID` | Apple ID for notarization | Required |
| `APPLE_PASSWORD` | App-specific password for notarization | Required |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Required |

## 2. Lifecycle operations

### 2-1. Initial registration
1. Export signing certificate as `.p12`
2. Base64-encode it and store in `APPLE_CERTIFICATE`
3. Register related passwords in repository secrets
4. Verify using `pnpm verify:updater` and release workflow run

#### 2-1-1. `APPLE_CERTIFICATE` registration command example

```bash
base64 < ./certs/developer-id-application.p12 | tr -d '\n' > /tmp/apple-certificate.base64
gh secret set APPLE_CERTIFICATE < /tmp/apple-certificate.base64
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set KEYCHAIN_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_PASSWORD
gh secret set APPLE_TEAM_ID
```

Post-registration format check (run in the same shell after exporting values):

```bash
APPLE_CERTIFICATE="$(cat /tmp/apple-certificate.base64)" \
APPLE_CERTIFICATE_PASSWORD="***" \
KEYCHAIN_PASSWORD="***" \
APPLE_ID="user@example.com" \
APPLE_PASSWORD="***" \
APPLE_TEAM_ID="ABCDEFGHIJ" \
pnpm verify:apple-signing
```

### 2-2. Rotation
1. Generate new certificate/key set
2. Update secrets first (do not immediately delete old set)
3. Validate with a tag-triggered draft release
4. Revoke/remove old certificate/key after successful verification

### 2-3. Revocation / incident response
1. Identify compromised target (Updater key or Apple certificate)
2. Disable or replace affected secrets immediately
3. Record impacted versions/artifacts
4. Ship a patched release with highest priority

## 3. Permission model

Minimum separation of duties:
- Secrets edit: Maintainers only
- Release execution: Maintainers + designated release operators
- General developers: read-only repository access (no secret value access)

Review policy:
- At least two reviewers for secret changes
- Record reason and switch-over timestamp for every update

## 4. Audit checklist

Per sprint:
- [ ] All required secrets exist
- [ ] Revoked/legacy certificates and keys are removed
- [ ] Runbook and actual operation are aligned
- [ ] Recent release failures are converted into prevention actions

Before release:
- [ ] `pnpm verify:updater` passes
- [ ] Release workflow secret-validation step passes
- [ ] Draft release contains all expected artifacts

## 5. Change record template (recommended)

- Changed at:
- Changed by:
- Changed secrets:
- Reason:
- Verification run URL:
- Rollback plan:
