# API-663 spike, approach A: n8n sends the ORD ID

Spike code for SAP to test in Joule Studio. Do not merge. Context:
[API-663](https://linear.app/n8n/issue/API-663). Approach B (fully authless) is on branch
`api-663-approach-b-authless`.

## What it does

In managed mode, n8n holds no secret:

- Every node's credential field shows **Managed by SAP**, disabled. Users cannot change it.
- **No credential is stored.** Each node's credential reference in the workflow JSON holds
  only an **ORD ID**, with no record behind it. Gateway credits marks a node the same way.
- Every request a node sends carries that ORD ID in the `ordID` header, and **no
  `Authorization` header**.
- SAP's proxy catches the request. Agent Gateway (AGW) checks the grant and adds the real
  secret. n8n needs no other setup for this: no proxy settings, no plug-in.

## Configuration

Two settings and one file:

| Part | Value | Effect |
|---|---|---|
| Credential type file | `SapManagedApi.credentials.js`, in a folder | Defines "Managed by SAP". An example is in `managed-credential/`. SAP can change its name, display name and notice |
| `N8N_CUSTOM_EXTENSIONS` | The folder that holds the file | n8n loads the file at startup, the same way it loads custom nodes |
| `N8N_MANAGED_CREDENTIAL_TYPE` | `sapManagedApi` (the `name` in the file) | Turns managed mode on. Every node then uses this type. When unset, n8n works as today |

In a Docker image, copy the folder into the image or mount it, and set both variables.

**How the setting overrides a node's credential types:** each node lists the credential
types it accepts (Slack accepts only "Slack API" and "Slack OAuth2"). In managed mode, the
editor sees the managed type as the only credential of every node. When the node runs and
asks for "Slack API", n8n reads the ORD ID from the node's "Managed by SAP" reference, and
gives the node data built from the "Slack API" fields, with empty secrets. The node itself
does not change.

## What Joule Studio does

1. **Find the ORD ID** of each application the workflow uses, in UMS.
2. **Write it into the workflow JSON**, on every node that calls an application:

   ```json
   "credentials": { "sapManagedApi": { "id": null, "name": "Outlook", "ordId": "<ORD ID>" } }
   ```

3. **On deploy**, nothing moves but the workflow. If prod needs a different ORD ID, set it
   in the workflow JSON.

n8n refuses to create any credential in managed mode. A node with no ORD ID fails before it
sends anything, with the error `Add an ORD ID to this node's "Managed by SAP" credential`.

## What SAP's proxy and AGW receive

| Part of the request | Value |
|---|---|
| `ordID` header | The ORD ID on the node. It replaces any `ordID` header the workflow sets |
| `Authorization` header | None, for nodes that use n8n's auth helpers (about 63% of built-in integrations) |
| Nodes that build their own auth header (about 25%) | The header is present, with an empty key, for example `Basic Olg=`. AGW must replace it |
| Address fields from the credential (Jira, self-hosted apps) | A placeholder, for example `https://example.atlassian.net`. AGW routes by ORD ID |

## Test it

```bash
pnpm build > build.log 2>&1
cd packages/cli && N8N_CUSTOM_EXTENSIONS=../../spike/api-663/managed-credential \
  N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi pnpm start
```

1. Create a workflow with a Slack node whose `credentials` hold an ORD ID, as above.
2. Open the Slack node: the Credential field shows **Managed by SAP**, disabled.
3. Run it. Without SAP's proxy, Slack rejects the call: the request left n8n with no token.
4. To see the headers, run an HTTP Request node (Authentication: Predefined Credential Type,
   Managed by SAP) against a server that prints them.

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
| `n8n import:credentials` | Still stores any credential type. n8n never uses it in managed mode |
| The disabled field does not show the node's ORD ID | UI only |

## Where the code is

| File | Change |
|---|---|
| `spike/api-663/managed-credential/SapManagedApi.credentials.js` | Example "Managed by SAP" credential type |
| `packages/core/.../utils/managed-credential.ts` | Reads the ORD ID from the node, builds the node's credential data, adds the ORD ID |
| `packages/core/.../node-execution-context.ts` | In managed mode, reads no stored credential |
| `packages/core/.../request-helpers/factory.ts` | Auth helpers and OAuth paths add nothing but the ORD ID |
| `packages/cli/src/spike-managed-credential-types.ts` | Editor sees only the managed type; no credential can be saved |
| `workflow-helpers.ts`, `credentials-permission-checker.ts`, `workflow.service.ee.ts` | Skip the managed reference, which has `id: null` by design, like a Gateway credits reference |
| `packages/cli/src/workflows/workflow-validation.service.ts` | Publishing skips the credential check in managed mode |
| `packages/frontend/editor-ui/.../NodeCredentials.vue`, `useNodeHelpers.ts` | Disabled "Managed by SAP" field, no "missing credential" warning |
