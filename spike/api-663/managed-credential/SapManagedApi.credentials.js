'use strict';

// Approach A. Example credential type for N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi.
// n8n loads it from the folder in N8N_CUSTOM_EXTENSIONS, like a custom node. It is never
// stored. A node references it in the workflow JSON with only an ORD ID:
// `{ "id": null, "name": "Outlook", "ordId": "<ORD ID>" }`. n8n sends that ORD ID with every
// request of the node, with no secret, and SAP Agent Gateway adds the real one.
class SapManagedApi {
	constructor() {
		this.name = 'sapManagedApi';
		this.displayName = 'Managed by SAP';
		this.icon = 'fa:building';
		this.properties = [
			{
				displayName:
					'SAP Agent Gateway adds the real credentials when the request leaves n8n. Nothing to configure here.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		];
		// The editor shows this credential as a fixed, disabled value.
		this.systemManaged = true;
		// Lists the type under HTTP Request > Predefined Credential Type.
		this.httpRequestNode = { name: 'Managed by SAP', docsUrl: '', apiBaseUrlPlaceholder: 'https://' };
		// Adds nothing to the request. HTTP Request lists only types that define `authenticate`.
		this.authenticate = { type: 'generic', properties: {} };
	}
}

module.exports = { SapManagedApi };
