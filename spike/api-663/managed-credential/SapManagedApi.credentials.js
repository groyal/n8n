'use strict';

// Approach A. Example credential type for N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi.
// n8n loads it from the folder in N8N_CUSTOM_EXTENSIONS, like a custom node. Each credential
// holds one ORD ID and no secret. n8n sends the ORD ID with every request of a node this
// credential is linked to. SAP Agent Gateway adds the real secret.
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
			// n8n reads this field by name and sends it as the `ordID` header.
			{ displayName: 'ORD ID', name: 'ordId', type: 'string', default: '', required: true },
		];
		// The editor shows the linked credential as a fixed, disabled value.
		this.systemManaged = true;
		// Lists the type under HTTP Request > Predefined Credential Type.
		this.httpRequestNode = { name: 'Managed by SAP', docsUrl: '', apiBaseUrlPlaceholder: 'https://' };
		// Adds nothing to the request. HTTP Request lists only types that define `authenticate`.
		this.authenticate = { type: 'generic', properties: {} };
	}
}

module.exports = { SapManagedApi };
