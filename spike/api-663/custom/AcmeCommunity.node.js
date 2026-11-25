'use strict';
// Stand-in for a programmatic community node (like Tavily): getCredentials + httpRequestWithAuthentication.
class AcmeCommunity {
	constructor() {
		this.description = {
			displayName: 'Acme Community', name: 'acmeCommunity', group: ['transform'], version: 1,
			description: 'Spike stand-in for a community node', defaults: { name: 'Acme Community' },
			inputs: ['main'], outputs: ['main'],
			credentials: [{ name: 'acmeCommunityApi', required: true }],
			properties: [{ displayName: 'Query', name: 'query', type: 'string', default: 'hello' }],
		};
	}
	async execute() {
		const credentials = await this.getCredentials('acmeCommunityApi');
		const query = this.getNodeParameter('query', 0);
		const response = await this.helpers.httpRequestWithAuthentication.call(this, 'acmeCommunityApi', {
			method: 'POST', url: `${credentials.baseUrl}/search`, body: { query }, json: true,
		});
		return [[{ json: { response: response ?? null } }]];
	}
}
module.exports = { AcmeCommunity };
