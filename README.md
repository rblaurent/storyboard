# Storyboard

Storyboard is a Leaf extension with a standalone campaign notebook, a federated Leaf management/settings panel, and a Cloudflare route relay. The backend uses plugin-keyed Leaf SDK entity/record stores and the host’s AI, workflow, Compute and asset services. It has no private database, browser bearer credentials, recurring legacy sync, or deployment hook.

This repository is the canonical source on `main`. Staging receipts record the source commit, dirty state, SDK ABI hash and every source/package file hash. No remote is required or created. Nova owns one-time migration execution, Shinsekai’s themed adapter, acceptance, and release.

## Build and source checks

Use Node 22.12+, pnpm 11.0.9, .NET 9, and an explicitly supplied compatible Leaf SDK project or assembly. Set `REDLEAF_SCRATCH_DIR` to an existing directory outside this repository. Install the locked frontend dependencies with `pnpm install --frozen-lockfile`. No personal SDK path is embedded in the project or scripts.

```powershell
pnpm typecheck
dotnet test tests/Storyboard.Backend.Tests/Storyboard.Backend.Tests.csproj --artifacts-path "$env:REDLEAF_SCRATCH_DIR/storyboard/check-build" "-p:LeafSdkProject=$sdkProject"
pnpm worker:test
pnpm test:frontend
node --test operator/migration.test.mjs
./stage.ps1 -LeafSdkProject $sdkProject
# Alternatively: ./stage.ps1 -LeafSdkAssembly $sdkAssembly
```

`stage.ps1` runs backend/TestHost, operator, Worker and browser source tests, then invokes `build-leafpkg.ps1`. `build-leafpkg.ps1` publishes the backend, typechecks both TypeScript packages, and runs `build:plugin` and `build:site`. Standalone builds accept `STORYBOARD_SITE_OUTPUT`; federation builds accept `STORYBOARD_PLUGIN_OUTPUT`. Set both to scratch for individual builds. Package staging sets them automatically. Package contents are:

- `plugin.json` and `seeds/`.
- `backend/Leaf.Plugins.Storyboard.dll`, its product dependencies, and `backend/site/` beside the DLL.
- `web/dist/` with `remoteEntry.js`, `plugin.js`, `plugin.css` and federation chunks.

Host SDK assemblies are excluded. Worker and one-time operator source are separate deliverables and are not runtime package contents. Staging writes a `.leafpkg`, SHA256, a receipt with source commit/dirty state, SDK hash and all artifact/source hashes, plus `latest-stage.json`, entirely under scratch. These scripts do not install, activate, restart, create a remote, publish or deploy.

The backend suite exports its actual ASP.NET cookie headers to scratch; the Worker propagation test consumes that receipt, so run backend tests before `worker:test`. The browser CSP regression loads the built site with a response header produced by the actual Worker relay and checks decoded blob artwork and CSP violations. The Playwright suite uses a labelled disposable API fixture, including a host-themed UI harness. Screenshots and browser traces stay under scratch. These checks prove source behavior/layout, not real Google authentication or live Leaf-shell acceptance. Pass `-LeafPolicyProject $hostPolicyProject` to `stage.ps1` to additionally run the actual shared host confidentiality-policy tests; that project is referenced only by tests and all its build output stays in scratch. The backend tests inject Google/Compute adapters and test-only SDK stores; no production validation bypass is registered.

## Authentication and command behavior

Standalone Google authorization uses `/auth/google`, PKCE, an encrypted one-use login state/nonce/verifier, and the official Google validation library for signatures, issuer, audience, expiry and verified email. Subjects are opaque nonblank strings up to 255 characters. Browser sessions are opaque secure HttpOnly host cookies, revocable in the backend; mutating standalone calls require same-origin JSON and `X-CSRF-Token`. The browser has no Leaf/Agent token or credential storage. Only the archived-picker preference is persistent; sessionStorage operation IDs are resume hints.

OAuth transaction/account/session mutations, campaign edits, archive/restore, membership commands, eligibility changes, portal writes, and generation publication/application share a singleton command gate. SDK timestamp CAS handles retries. A removed/demoted GM is checked again after waiting for the gate, and a last GM cannot be removed or demoted. Unchanged saves retain summary staleness. Conflicting drafts remain in the frontend.

Generation records a staged intent before publishing a campaign’s newest-operation pointer. Staged intents cannot execute; recovery publishes or rejects their recorded previous pointer under the same gate. UUID reuse must match kind, prompt and expected revision. Queue queries select only nonterminal states and enforce the per-account limit. Visual brief, quality mode, campaign input, deadline, workflow entity revision, landscape dimensions, seed, steps and cfg are recorded at queue time. Text and image jobs use stable idempotency keys; image output upload is idempotent. A 20-minute deadline bounds execution, excluding recorded operator-fence pauses. Fences pause staged/pending work and final application; exact job/result receipts are retained for resume. Lost membership cancels only that operation, allowing later staged intents to recover. Application requires both the original campaign revision and newest operation pointer; the saved document determines `applied`, including on CAS retry. Stale/failed output retains the existing cover.

The provider owns workflow validation/materialization and freezes its graph at Compute submission. The installed `IComfyUiWorkflows` interface exposes only `SubmitAsync`; it has no queue-time reviewed/live-version resolver. Storyboard records the workflow entity/revision, submits that entity through the provider, and rejects revision changes before/after submission. A provider-owned reviewed/live-version resolver remains an SDK/provider requirement; this repository does not implement graph preparation or bypass that boundary. Compute transport uses the capability slug returned by submission (currently `image-gen`), while extension dependencies use the live extension slug `image-generation`.

Compute jobs are **not guaranteed confidential** by this SDK: `AiRequest` and `ComputeJobOptions` expose no confidentiality field, and submission does not inherit confidentiality from entity context. Background provenance uses a system beneficiary, never an external Storyboard account UUID as a Leaf beneficiary. Product campaign/media/operation projections remain authenticated and membership-scoped; Compute authorization/storage visibility is a separate host boundary requiring live operator review.

Confidential entities require installation, human owner, a real owning Agent (`owner_agent_id`), and `confidential:true`; the keyed SDK stamps plugin ownership. The host’s confidential-resource policy and vault handle authorization/encryption. Portal secrets and OAuth nonce/verifier fields are declared secrets and are never returned by product projections. Settings use the standard `IPluginSettingsProvider` descriptor and host GET/PUT payload `{section,values,validateOnly}`. Secret replacement remains masked. Since the current host descriptor GET does not catch provider authorization exceptions, an unauthorized descriptor returns empty sections plus an error marker; the frontend displays it. PUT validation uses the host’s supported exception contract.

## Frozen generic portal contract

All portal routes are normal Leaf-authenticated `/api/apps/storyboard/portals/{key}` routes. The registered, confidential `storyboard-portal` entity contains `key`, `campaign`, `google_client_id`, encrypted `portal_secret`, `legacy_workspace`, `portrait_type`, `character_fields`, and optional `character_key`. No portal registration or Shinsekai-specific campaign/user data is seeded. Every call additionally requires an exact canonical 32-byte base64url secret in `X-Storyboard-Portal-Key`. It belongs only in the trusted portal server environment, alongside its existing Leaf server credential.

| Route | Input / response |
|---|---|
| `POST /identity` | `{idToken,nonce}` → `{accountId,ownerId,email,name,avatar,role}` |
| `GET /characters` | Trusted `X-Storyboard-Owner` → `{items:[entityEnvelope],total}` |
| `GET /characters/{id}` | Actor-owned canonical UUID or immutable legacy character UUID → entity envelope |
| `POST /characters` | `{name,data,operationId?}` with configured stable character key, or UUID `operationId` when no key is configured → entity envelope |
| `PATCH /characters/{id}` | `{name?,data?:gamePatch}` → entity envelope |

Identity uses the same official `IGoogleIdentity.ValidateAsync(token,nonce,audience,ct)` implementation as sign-in. Existing members retain their current role; removed members stay denied. Only a new account may auto-enroll as player in that configured campaign, with a recorded enrollment intent allowing interrupted first enrollment to resume. An existing account without membership requires a GM to add it. No portal grants GM, re-enables an account, or exposes a global account directory.

The trusted Cloudflare backend stamps `X-Storyboard-Owner` only from its verified portal JWT. Browsers cannot choose that header or see server credentials. Actor resolution accepts the canonical account UUID or its immutable `legacy_owner` within the configured campaign, requiring an enabled account and active membership. `ownerId` is exactly `legacy_owner` when present, otherwise the canonical UUID; JWT/session/profile/discussion ownership references can remain unchanged.

Envelope shape is `{id:canonicalCharacterUUID,typeSlug:'storyboard-character',name,slug,data:{...configuredGameFields,account:ownerId,parent:legacy_workspace}}`. Full historical `game_data` is retained in the confidential canonical entity; only registered fields are projected. Registration supplies a `character_fields` object whose keys map to `{type:'string'|'portrait',maxLength:1..4000}`, `{type:'integer',min,max}` (within �1 billion), or `{type:'boolean'}`. There may be one portrait descriptor, resolved through the registered `portrait_type`. Authority/credential keys cannot be registered or patched. Unconfigured fields are rejected on PATCH and omitted from public projection.

`character_key`, when set, names a string descriptor and is immutable after creation. Otherwise POST requires UUID `operationId`. One character per campaign/player is the current creation contract; identical creation retry returns it and conflicting retry returns 409. Legacy ID aliases are immutable and resolved only within actor ownership and campaign. All references remain canonical outside the compatibility envelope.

Portrait reads use the registered entity type, verify the configured legacy workspace and actor compatibility owner (or shared/unowned portrait), and retain the original entity reference and asset bytes. The canonical portrait field stores the asset ID derived from a validated source `image_url`; no asset is regenerated. Management validates canonical relationships, aliases, registered schema and portrait ownership. Original Shin source types, schema and source fingerprints are checked only by the one-time operator, which supplies that portal's declarative registration before character records.

## Operator sequencing

The ordinary owner-only management API provides:

- `PUT /api/apps/storyboard/manage/fence {writesFenced:boolean}`; changing the fence records a settings audit entry.
- `GET /manage/entities/{type}/{slug}` with redacted secret status.
- `PUT /manage/entities/{type}/{slug} {name,data,expectedUpdatedAt}` for curated account/campaign/player/character/portal records while fenced. Explicit null means absent-row CAS. Existing-row timestamp CAS is mandatory. Protection fields come from the SDK/configuration; immutable identities cannot be changed. This is single-record operational configuration, with no bulk/import endpoint or runtime migration hook.

The one-time `operator/migrate-shinsekai.mjs` was promoted from Nova’s deliberate source and hardened. It has `prepare`, `apply`, and `verify` modes only. Use an owner-authorized signed execution credential through trusted loopback; the tool derives the human beneficiary and verified Leaf Google identity. A portal secret is a separate credential and never an Agent bearer. Normal host permissions still govern read inventories; the typed Storyboard management API enforces extension ownership and CAS rather than assuming DevMode.

```powershell
node operator/migrate-shinsekai.mjs --mode prepare --output "$env:REDLEAF_SCRATCH_DIR/storyboard/operator-run"
# Nova runs apply/verify only after the coordinated operator prerequisites below.
```

`prepare` reads source inventories, verifies complete counts, Google-subject uniqueness, source workspace/owner/portrait references, and fingerprints source JSON in canonical key order plus portrait bytes. Private exports and manifests are written only inside scratch. Version-1 preparation manifests must be re-prepared for the version-2 CAS/asset receipt contract. No private subjects, exports, backups or plans belong in Git or packages.

After package review and real OAuth configuration, coordinate the standard Leaf restart/activation and the independently reviewed portal adapter release. Nova then prepares the installation, fences Storyboard through the owner API, and verifies the portal’s public `/storyboard-status` reports `{version:'storyboard/1',writesFenced:true}`. Both fences are required before every apply write. The tool records exact account/member/character/portal/campaign IDs incrementally and records ready intent before final CAS. A crash after ready publication is reconciled only against that exact intent. Foreign runs, unexpected target IDs, canonical accounts created by another sign-in, changed source fingerprints or portrait bytes fail reconciliation; they are never overwritten. Source accounts, portraits, transcripts and existing legacy owner references are not rewritten. It reuses the native page workspace; `view=workspace` is unnecessary.

Apply also requires an actual Google portal client ID and a canonical 32-byte `STORYBOARD_PORTAL_SECRET` in its server environment. Keep both fences in place until Nova’s verification and real authenticated acceptance are complete; coordinated removal is an operator action, not automatic apply behavior.

## Pending live checks

Real OAuth credentials are not available in this source milestone; local portal variable placeholders are insufficient. Register the new Storyboard Google callback `https://storyboard.minititine.cc/auth/callback`, configure product Google credentials and the matching Worker relay key through protected settings/server secret storage, and configure each portal’s audience/secret independently. Worker `wrangler.jsonc` names only the new `storyboard` Worker and proposes `storyboard.minititine.cc`; it has not been published.

The relay proof is timestamp-bound to method, target path/query and origin with a 30-second acceptance window. This frozen protocol has no per-request nonce or body digest, so it cannot distinguish an identical proof replay inside that window. Browser session/CSRF checks and command UUID/revision checks remain required; tests verify forgery/fail-closed handling and expired replay denial. Changing that proof protocol requires coordinated Worker/backend agreement.

No production migration, deployment, restart, activation, actual Google sign-in, real provider execution, or authenticated staged Leaf-shell acceptance is claimed by source tests or staging. The package/evidence remain reviewable for Nova’s coordinated next step.
