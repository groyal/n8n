import type { IAuthenticateGeneric, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

/**
 * Spike (API-663), approach A. Used only when N8N_MANAGED_CREDENTIAL_TYPE=sapManagedApi.
 * Holds one ORD ID and no secret. SAP Agent Gateway adds the real secret to each request.
 */
export class SapManagedApi implements ICredentialType {
	name = 'sapManagedApi';

	displayName = 'Managed by SAP';

	documentationUrl = 'httprequest';

	icon: Icon = 'fa:building';

	/** The editor shows the linked credential as a fixed, disabled value. */
	systemManaged = true;

	properties: INodeProperties[] = [
		{
			displayName:
				'SAP Agent Gateway adds the real credentials when the request leaves n8n. Nothing to configure here.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'ORD ID',
			name: 'ordId',
			type: 'string',
			default: '',
			required: true,
		},
	];

	// Adds nothing to the request. HTTP Request lists only types that define `authenticate`.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {},
	};

	httpRequestNode = {
		name: 'Managed by SAP',
		docsUrl: '',
		apiBaseUrlPlaceholder: 'https://',
	};
}
