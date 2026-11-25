# API-663 spike, approach B: fully authless

Spike code only. Do not merge. Context and findings: see the Notion page linked in
[API-663](https://linear.app/n8n/issue/API-663).

## What it shows

In managed mode, n8n holds no secret and stores no credential. Every node's credential
field shows "Managed by SAP" as a fixed, disabled value. At run time n8n builds that
credential from the node's own credential type: secret fields stay empty, and address
fields get a stand-in value. Each request leaves n8n with no secret and no ORD ID. SAP's
Agent Gateway (AGW) maps the request to its ORD ID and adds the real secret. A local mock
stands in for AGW.

Approach A (n8n sends the ORD ID) is on branch `api-663-approach-a-ord-id`.

The pattern follows the AI Gateway "Gateway credits" option, which also gives a node a
credential that has no stored record.

## Configuration

| Part | What it does |
|---|---|
| `N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi` | Turns managed mode on. When unset, n8n works as today |
| `custom/SapManagedApi.credentials.js` | The credential type, loaded from a folder like a custom node (`N8N_CUSTOM_EXTENSIONS`). `systemManaged: true` tells the editor to show it as a disabled value |
| Node credential lists | The editor sees `sapManagedApi` as the only credential of every node (except HTTP Request). The server keeps each node's real list, so n8n still knows which type a node asks for |
| `N8N_SPIKE_EGRESS_URL` | Sends every outbound request to the mock. Stands in for SAP's proxy |

## Start

```bash
pnpm build > build.log 2>&1          # once, from the repo root
spike/api-663/start.sh --reset        # mock AGW on :4010, n8n on :5681
```

`--reset` deletes the instance data in `spike/api-663/.data`. Leave it out to keep it.

## Automated check (2 minutes)

```bash
node spike/api-663/check.mjs
```

It creates the owner (`spike@example.com` / `SpikePassword123`) and one workflow per case.
Then it runs them and reads what the mock received. Expected result: 17 `PASS`,
3 `KNOWN GAP`, 0 `FAIL`.

Unit tests:

```bash
cd packages/core && pnpm test src/execution-engine/node-execution-context/utils/__tests__/managed-credential.test.ts
cd packages/cli && pnpm test src/__tests__/spike-managed-credential-types.test.ts
```

## Manual test in the UI (10 minutes)

Open two tabs: n8n at http://localhost:5681 and the mock at http://localhost:4010/_mock.
Sign in as `spike@example.com` / `SpikePassword123` (run `check.mjs` once first, or create
the owner in the UI).

| # | Do this | Expect |
|---|---|---|
| 1 | New workflow. Add **Slack → Send a message**, channel ID `C0123456789`, text `hello` | The Credential field shows **Managed by SAP**, disabled. No warning |
| 2 | Click **Execute workflow** | Success. The mock shows `POST slack.com/api/chat.postMessage`, ordID `none`, Authorization `none` |
| 3 | Open **Credentials** | The list is empty. No credential was stored |
| 4 | Add **Google Sheets** | Authentication offers **OAuth2** only. The credential shows Managed by SAP, disabled |
| 5 | Add **HTTP Request**. Authentication = **Predefined Credential Type** | The type list has only **Managed by SAP**. The credential is disabled |
| 6 | Add **Acme Community** (the test community node), run | `POST api.acme-community.dev/search`, no ordID, no Authorization |
| 7 | Add a **Schedule Trigger** before Slack and **Publish** | Publishing succeeds, although no node has a stored credential |

Things to try that must fail:

- Create any credential (UI or API): `400 Credentials cannot be created on this instance`.
- Open `spike check: Node with a real (imported) Slack credential: n8n ignores it` and run it.
  The mock shows the request with no `Authorization`: n8n ignored the real credential.

## Known gaps (expected)

| Gap | What you see |
|---|---|
| Node signs a token itself (Google service account) | Fails before sending. Hidden in the editor |
| Secret in the URL (Telegram, about 5% of integrations) | Fails before sending: n8n refuses a URL with an empty token. A stand-in token would fix it, but SAP wants no stand-in secrets |
| `n8n import:credentials` | Still stores credentials. n8n never uses them |
| "Create credential" still lists Managed by SAP | Saving fails. Studio users have no permission to create credentials |

## Where the code is

| File | Change |
|---|---|
| `packages/core/.../utils/managed-credential.ts` | Builds the credential data |
| `packages/core/.../node-execution-context.ts` | In managed mode, `_getCredentials` builds the data and reads no record |
| `packages/core/.../request-helpers/factory.ts` | Auth helpers and OAuth paths use the managed type, which adds nothing |
| `packages/cli/src/spike-managed-credential-types.ts` | Editor sees only the managed type; nothing can be saved |
| `packages/cli/src/workflows/workflow-validation.service.ts` | Publish skips the credential check in managed mode |
| `packages/frontend/editor-ui/.../NodeCredentials.vue`, `useNodeHelpers.ts` | Disabled "Managed by SAP" field, no "missing credential" warning |
| `packages/@n8n/backend-network/src/http/spike-egress.ts` | Stand-in for SAP's proxy. Not part of a real design |
| `spike/api-663/` | Credential, test node, mock AGW, scripts |
