'use strict';

// Holds no secret and no ORD ID. Standard nodes get their fixed ORD ID from core;
// generic HTTP stores its ORD ID in the workflow (SAP's design-time UMS lookup).
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
		// n8n builds this credential at run time. The editor shows it as a fixed, disabled value.
		this.systemManaged = true;
		// Lists the type under HTTP Request > Predefined Credential Type.
		this.httpRequestNode = { name: 'Managed by SAP', docsUrl: '', apiBaseUrlPlaceholder: 'https://' };
		// Adds nothing. HTTP Request lists only types that define `authenticate`.
		this.authenticate = { type: 'generic', properties: {} };
	}
}

module.exports = { SapManagedApi };
