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

// SPIKE (API-663): approach A. The ORD ID comes from the "Managed by SAP" credential that
// is linked to the node. It is recorded when the node reads its credential, and added to
// every request that node sends, including requests it builds itself.
const ordIdByNode = new WeakMap<INode, string>();

export function rememberManagedOrdId(node: INode, ordId: unknown): void {
	if (typeof ordId === 'string' && ordId) ordIdByNode.set(node, ordId);
}

export function addManagedOrdId<T extends { headers?: object }>(node: INode, options: T): T {
	const ordId = ordIdByNode.get(node);
	if (!ordId) return options;
	return { ...options, headers: { ...options.headers, ordID: ordId } };
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
