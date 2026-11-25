import type { ICredentialDataDecryptedObject, INode, INodeProperties } from 'n8n-workflow';

// SPIKE (API-663): one operator-defined credential type that stands in for every
// credential type a node asks for. Read from env so the spike needs no config class.
export function getManagedCredentialType(): string | undefined {
	return process.env.N8N_MANAGED_CREDENTIAL_TYPE || undefined;
}

/**
 * In managed mode every credential lookup resolves to the managed type, so a real
 * credential on the node is never used. A node without the managed credential fails
 * in `_getCredentials` before any request is sent.
 */
export function resolveManagedCredentialType(_node: INode, requestedType: string): string {
	return getManagedCredentialType() ?? requestedType;
}

// SPIKE (API-663): fixed ORD ID per credential type (or node type for shared types).
// The node never sees it; it is added to the request only when the managed type stands in.
function getOrdIdMap(): Record<string, string> {
	try {
		return JSON.parse(process.env.N8N_SPIKE_ORD_ID_MAP ?? '{}') as Record<string, string>;
	} catch {
		return {};
	}
}

export function addManagedOrdId<T extends { headers?: object }>(
	node: INode,
	requestedType: string,
	resolvedType: string,
	requestOptions: T,
): T {
	if (resolvedType === requestedType) return requestOptions;
	return withOrdId(node, requestedType, requestOptions);
}

function withOrdId<T extends { headers?: object }>(
	node: INode,
	requestedType: string,
	requestOptions: T,
): T {
	const map = getOrdIdMap();
	const ordId = map[requestedType] ?? map[node.type];
	if (!ordId) return requestOptions;
	return { ...requestOptions, headers: { ...requestOptions.headers, ordID: ordId } };
}

// Nodes that read credentials and then send with plain `httpRequest`/`request` never pass
// a type to the helper, so remember which type the node asked for.
const requestedTypeByNode = new WeakMap<INode, string>();

export function rememberManagedRequest(node: INode, requestedType: string): void {
	requestedTypeByNode.set(node, requestedType);
}

export function addRememberedOrdId<T extends { headers?: object }>(node: INode, options: T): T {
	const requestedType = requestedTypeByNode.get(node);
	return requestedType ? withOrdId(node, requestedType, options) : options;
}

const PLACEHOLDER_URL = 'https://sap-managed.example.com';
const PLACEHOLDER_TEXT = 'sap-managed';
const URL_LIKE_FIELD = /url|domain|host|endpoint|server|instance/i;

/**
 * Nodes read config fields (Jira `domain`, Zendesk `subdomain`) from their own type.
 * Give them the type's defaults, else the field's UI example, else a placeholder. AGW finds the real target from the
 * ORD ID, so the placeholder host never leaves SAP's network.
 */
export function fillManagedPlaceholders(
	properties: INodeProperties[],
	managedData: ICredentialDataDecryptedObject,
): ICredentialDataDecryptedObject {
	const filled: Record<string, unknown> = {};
	for (const property of properties) {
		if (property.type === 'notice' || property.type === 'hidden') {
			if (property.default !== undefined) filled[property.name] = property.default;
			continue;
		}
		// SAP's gateway adds the real secret, and wants no stand-in value in its place.
		if (property.typeOptions?.password) {
			filled[property.name] = '';
			continue;
		}
		const hasDefault = property.default !== undefined && property.default !== '';
		if (hasDefault) filled[property.name] = property.default;
		// The UI example value has the format the node expects (full URL vs subdomain).
		else if (property.type === 'string' && property.placeholder)
			filled[property.name] = property.placeholder;
		else if (property.type === 'string')
			filled[property.name] = URL_LIKE_FIELD.test(property.name)
				? PLACEHOLDER_URL
				: PLACEHOLDER_TEXT;
	}
	return { ...filled, ...managedData } as ICredentialDataDecryptedObject;
}
