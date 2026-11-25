# API-663 spike, approach A: n8n sends the ORD ID

Spike code only. Do not merge. Context and findings: see the Notion page linked in
[API-663](https://linear.app/n8n/issue/API-663).

## What it shows

In managed mode, n8n holds no secret. Every node's credential field shows "Managed by
SAP" as a fixed, disabled value. Each node links one "Managed by SAP" credential that holds
an ORD ID and no secret. Joule Studio's assistant would create it through n8n's API and
put its ID in the workflow JSON. At run time n8n reads the ORD ID from that credential and
sends it as the `ordID` header. n8n builds the node's own credential data with empty
secrets and stand-in addresses. SAP's Agent Gateway (AGW) adds the real secret. A local
mock stands in for AGW.

Approach B (fully authless, no ORD ID) is on branch `api-663-approach-b-authless`.

The pattern follows the AI Gateway "Gateway credits" option, which also gives a node a
credential that has no stored record.

## Configuration

| Part | What it does |
|---|---|
| `N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi` | Turns managed mode on. When unset, n8n works as today |
| `custom/SapManagedApi.credentials.js` | The credential type, loaded from a folder like a custom node (`N8N_CUSTOM_EXTENSIONS`). One field: `ordId`. `systemManaged: true` tells the editor to show it as a disabled value |
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

It creates the owner (`spike@example.com` / `SpikePassword123`), one "Managed by SAP"
credential per ORD ID through the API, and one workflow per case with that credential
linked. Then it runs them and reads what the mock received. Expected result: 18 `PASS`,
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
| 1 | Open `spike check: Slack (requestWithAuthentication)` and the Slack node | The Credential field shows **Managed by SAP**, disabled. No warning |
| 2 | Click **Execute workflow** | Success. The mock shows `POST slack.com/api/chat.postMessage`, `ordID = …SLACK:v1` (from the linked credential), Authorization `none` |
| 3 | Open **Credentials** | Only "ORD …" credentials, each holding one ORD ID |
| 4 | Add **Google Sheets** | Authentication offers **OAuth2** only. The credential shows Managed by SAP, disabled |
| 5 | Add **HTTP Request**. Authentication = **Predefined Credential Type** | The type list has only **Managed by SAP**. The credential is disabled |
| 6 | Open `spike check: HTTP Request (linked credential wins over a typed header)` and run | The mock shows the credential's ORD ID, not the typed header |
| 7 | Open `spike check: Community-style node…` and run | `POST api.acme-community.dev/search`, `ordID = …ACME_COMMUNITY:v1` |
| 8 | Open `spike check: publish…` | It was published |

Things to try that must fail:

- Create any other credential type (UI or API): `400 Only "sapManagedApi" credentials can be created`.
- Open `spike check: Node with a real (imported) Slack credential: n8n ignores it` and run it.
  The mock shows the request with no `Authorization`: n8n ignored the real credential.
- Open `spike check: Node with no linked credential fails before sending`. The node fails with
  "Link a Managed by SAP credential with an ORD ID". The mock receives nothing.

## Known gaps (expected)

| Gap | What you see |
|---|---|
| Node signs a token itself (Google service account) | Fails before sending. Hidden in the editor |
| Secret in the URL (Telegram, about 5% of integrations) | Fails before sending: n8n refuses a URL with an empty token. A stand-in token would fix it, but SAP wants no stand-in secrets |
| `n8n import:credentials` | Still stores credentials. n8n never uses them |
| The disabled field does not show which ORD ID credential is linked | UI only |

## Where the code is

| File | Change |
|---|---|
| `packages/core/.../utils/managed-credential.ts` | Builds the credential data, records and adds the ORD ID |
| `packages/core/.../node-execution-context.ts` | In managed mode, `_getCredentials` reads only the linked ORD ID credential and builds the node's data |
| `packages/core/.../request-helpers/factory.ts` | Auth helpers and OAuth paths use the managed type and add the ORD ID |
| `packages/cli/src/spike-managed-credential-types.ts` | Editor sees only the managed type; only that type can be saved |
| `packages/cli/src/workflows/workflow-validation.service.ts` | Publish skips the credential check in managed mode |
| `packages/frontend/editor-ui/.../NodeCredentials.vue`, `useNodeHelpers.ts` | Disabled "Managed by SAP" field, no "missing credential" warning |
| `packages/@n8n/backend-network/src/http/spike-egress.ts` | Stand-in for SAP's proxy. Not part of a real design |
| `spike/api-663/` | Credential, test node, mock AGW, scripts |
