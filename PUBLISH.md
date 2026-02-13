# Publishing @clawhouse/clawhouse

All publishing happens through GitHub Actions via OIDC trusted publishing. No npm tokens are used — the GitHub Action authenticates directly with npm using a short-lived OIDC token.

Local `npm publish` is disabled by design.

## How to publish

### 1. Bump the version in `package.json`

```bash
# stable
"version": "0.2.0"

# prerelease
"version": "0.2.0-alpha.1"
```

### 2. Commit and push

```bash
git add package.json
git commit -m "v0.2.0"
git push
```

### 3. Tag and push the tag

The tag **must** match the version in `package.json` prefixed with `v`:

```bash
git tag v0.2.0
git push origin v0.2.0
```

### 4. Create a GitHub Release

Go to **Releases > Draft new release** on GitHub:

- Select the tag you just pushed
- For prereleases, check **"Set as a pre-release"**
- Publish the release

The Action runs automatically and publishes to npm.

## Version types

| Version in `package.json` | Tag | npm dist-tag | Install command |
|---|---|---|---|
| `0.2.0` | `v0.2.0` | `latest` | `npm i @clawhouse/clawhouse` |
| `0.2.0-alpha.1` | `v0.2.0-alpha.1` | `alpha` | `npm i @clawhouse/clawhouse@alpha` |
| `0.2.0-beta.1` | `v0.2.0-beta.1` | `beta` | `npm i @clawhouse/clawhouse@beta` |
| `0.2.0-rc.1` | `v0.2.0-rc.1` | `rc` | `npm i @clawhouse/clawhouse@rc` |

The dist-tag is derived automatically from the prerelease identifier in the version string. Stable versions always go to `latest`.

## Version progression

A typical feature cycle looks like:

```
0.1.0              <- current stable
0.2.0-alpha.1      <- early work on next release
0.2.0-alpha.2      <- iterate
0.2.0-beta.1       <- wider testing
0.2.0-rc.1         <- release candidate
0.2.0              <- stable
```

All versions are published from `main`. No release branches needed.

## Safeguards

- **Version/tag mismatch guard**: The workflow fails if `package.json` version doesn't match the git tag. This prevents accidental publishes of the wrong version.
- **OIDC trusted publishing**: No long-lived npm tokens. Authentication uses short-lived GitHub OIDC tokens that can only be issued by this repo's `publish.yml` workflow.
- **Provenance**: Every published package includes a cryptographic provenance statement linking it to the exact commit and workflow run.
- **`prepublishOnly`**: The build runs automatically before every publish. Stale `dist/` can never be published.

## OIDC configuration

The trusted publisher is configured on npmjs.com under the package settings:

- Owner: `clawhouse`
- Repository: `clawhouse-openclaw` (npm: `@clawhouse/clawhouse`)
- Workflow: `publish.yml`
- Environment: *(blank)*

If this gets misconfigured, the publish step will fail with an authentication error.
