'use strict';
// Stand-in for a third-party community package credential (API key + own base URL).
class AcmeCommunityApi {
	constructor() {
		this.name = 'acmeCommunityApi';
		this.displayName = 'Acme Community API';
		this.properties = [
			{ displayName: 'Base URL', name: 'baseUrl', type: 'string', default: '', placeholder: 'https://api.acme-community.dev' },
			{ displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '' },
		];
		this.authenticate = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };
	}
}
module.exports = { AcmeCommunityApi };
