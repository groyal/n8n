# API-663 spike, approach B: fully authless

Spike code for SAP to test in Joule Studio. Do not merge. Context:
[API-663](https://linear.app/n8n/issue/API-663). Approach A (n8n sends the ORD ID) is on
branch `api-663-approach-a-ord-id`.

## What it does

In managed mode, n8n holds no secret and stores no credential:

- Every node's credential field shows **Managed by SAP**, disabled. Users cannot change it,
  and there is nothing to create.
- When a node runs, n8n builds its credential with empty secrets.
- Every request a node sends has **no `Authorization` header** and **no ORD ID**.
- SAP's proxy catches the request. Agent Gateway (AGW) maps it to its ORD ID, checks the
  grant and adds the real secret. n8n needs no other setup for this: no proxy settings, no
  plug-in.

## Configuration

| Setting | Value | Effect |
|---|---|---|
| `N8N_MANAGED_CREDENTIAL_TYPE` | `sapManagedApi` | Turns managed mode on. When unset, n8n works as today and hides the "Managed by SAP" type |

The "Managed by SAP" credential type is built into n8n
(`packages/nodes-base/credentials/SapManagedApi.credentials.ts`). Workflows need no
credential reference. Creating any credential returns `400`.

## What SAP's proxy and AGW receive

| Part of the request | Value |
|---|---|
| Address | The node's normal target, for example `slack.com/api/chat.postMessage`. AGW maps it to an ORD ID |
| Shared addresses | Outlook, Teams and OneDrive all call `graph.microsoft.com`. AGW needs path rules to tell them apart |
| Address fields from the credential (Jira, self-hosted apps) | A stand-in, for example `https://example.atlassian.net`. AGW must map it to the customer's system |
| `Authorization` header | None, for nodes that use n8n's auth helpers (about 63% of built-in integrations) |
| Nodes that build their own auth header (about 25%) | The header is present, with an empty key, for example `Basic Olg=`. AGW must replace it |

## Test it

```bash
pnpm build > build.log 2>&1
cd packages/cli && N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi pnpm start
```

1. Create a workflow with a Slack node. The Credential field shows **Managed by SAP**,
   disabled. There is no warning.
2. Run it. Without SAP's proxy, Slack rejects the call: the request left n8n with no token.
3. To see the headers, run an HTTP Request node against a server that prints them.

Unit tests:

```bash
cd packages/core && pnpm test src/execution-engine/node-execution-context/utils/__tests__/managed-credential.test.ts
cd packages/cli && pnpm test src/__tests__/spike-managed-credential-types.test.ts
```

## Known limits

| Limit | Effect |
|---|---|
| Node signs a token itself (Google service account, S3) | Fails before sending. Google's option is hidden in the editor |
| Secret in the URL (Telegram, about 5%) | Fails before sending: n8n refuses a URL with an empty token |
| Not HTTP (databases, SSH, email, about 7%) | Cannot go through AGW |
| `n8n import:credentials` | Still stores credentials. n8n never uses them in managed mode |

## Where the code is

| File | Change |
|---|---|
| `packages/nodes-base/credentials/SapManagedApi.credentials.ts` | The "Managed by SAP" credential type |
| `packages/core/.../utils/managed-credential.ts` | Builds the node's credential data with no secret |
| `packages/core/.../node-execution-context.ts` | In managed mode, reads no stored credential |
| `packages/core/.../request-helpers/factory.ts` | Auth helpers and OAuth paths add nothing |
| `packages/cli/src/spike-managed-credential-types.ts` | Editor sees only the managed type; nothing can be saved |
| `packages/cli/src/workflows/workflow-validation.service.ts` | Publishing skips the credential check in managed mode |
| `packages/frontend/editor-ui/.../NodeCredentials.vue`, `useNodeHelpers.ts` | Disabled "Managed by SAP" field, no "missing credential" warning |
