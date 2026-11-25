import type { Types } from 'n8n-core';
import type { INodeTypeDescription } from 'n8n-workflow';

import {
	applyManagedCredentialToTypes,
	assertManagedCredentialType,
} from '@/spike-managed-credential-types';

const description = (d: Partial<INodeTypeDescription>): INodeTypeDescription =>
	({
		displayName: d.name,
		group: [],
		version: 1,
		defaults: {},
		inputs: [],
		outputs: [],
		properties: [],
		...d,
	}) as INodeTypeDescription;

const sheets = description({
	name: 'n8n-nodes-base.googleSheets',
	credentials: [
		{
			name: 'googleApi',
			required: true,
			displayOptions: { show: { authentication: ['serviceAccount'] } },
		},
		{
			name: 'googleSheetsOAuth2Api',
			required: true,
			displayOptions: { show: { authentication: ['oAuth2'] } },
		},
	],
	properties: [
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			default: 'serviceAccount',
			options: [
				{ name: 'Service Account', value: 'serviceAccount' },
				{ name: 'OAuth2', value: 'oAuth2' },
			],
		},
	],
});

const http = description({
	name: 'n8n-nodes-base.httpRequest',
	credentials: [{ name: 'httpSslAuth', required: true }],
	properties: [
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			default: 'none',
			options: [
				{ name: 'None', value: 'none' },
				{ name: 'Predefined Credential Type', value: 'predefinedCredentialType' },
				{ name: 'Generic Credential Type', value: 'genericCredentialType' },
			],
		},
	],
});

const types = (): Types => ({
	nodes: [description({ name: 'n8n-nodes-base.noOp' }), sheets, http],
	credentials: [
		{ name: 'slackApi', displayName: 'Slack', properties: [] },
		{ name: 'sapManagedApi', displayName: 'Managed by SAP', properties: [] },
	],
});

describe('spike managed credential types', () => {
	afterEach(() => {
		delete process.env.N8N_MANAGED_CREDENTIAL_TYPE;
	});

	describe('applyManagedCredentialToTypes', () => {
		it('only hides the managed credential type when managed mode is off', () => {
			const t = types();
			const before = structuredClone(t);
			applyManagedCredentialToTypes(t);
			expect(t.nodes).toEqual(before.nodes);
			expect(t.credentials.map((c) => c.name)).toEqual(['slackApi']);
		});

		describe('when managed mode is on', () => {
			let t: Types;
			beforeEach(() => {
				process.env.N8N_MANAGED_CREDENTIAL_TYPE = 'sapManagedApi';
				t = types();
				applyManagedCredentialToTypes(t);
			});

			it('sends only the managed credential type to the editor', () => {
				expect(t.credentials.map((c) => c.name)).toEqual(['sapManagedApi']);
			});

			it('lets nodes ask only for the managed type', () => {
				const sheetsOut = t.nodes.find((n) => n.name === sheets.name)!;
				expect(sheetsOut.credentials).toEqual([{ name: 'sapManagedApi', required: true }]);
			});

			it('removes auth options whose node signs a token itself', () => {
				const auth = t.nodes.find((n) => n.name === sheets.name)!.properties[0];
				expect(auth.options?.map((o) => ('value' in o ? o.value : undefined))).toEqual(['oAuth2']);
				expect(auth.default).toBe('oAuth2');
			});

			it('keeps HTTP Request credentials and removes only the generic type', () => {
				const httpOut = t.nodes.find((n) => n.name === http.name)!;
				expect(httpOut.credentials).toEqual(http.credentials);
				expect(
					httpOut.properties[0].options?.map((o) => ('value' in o ? o.value : undefined)),
				).toEqual(['none', 'predefinedCredentialType']);
			});

			it('leaves nodes without credentials alone', () => {
				expect(t.nodes.find((n) => n.name === 'n8n-nodes-base.noOp')!.credentials).toBeUndefined();
			});
		});
	});

	describe('assertManagedCredentialType', () => {
		it('allows any type when managed mode is off', () => {
			expect(() => assertManagedCredentialType('slackApi')).not.toThrow();
		});

		it('allows only the managed type when managed mode is on', () => {
			process.env.N8N_MANAGED_CREDENTIAL_TYPE = 'sapManagedApi';
			expect(() => assertManagedCredentialType('sapManagedApi')).not.toThrow();
			expect(() => assertManagedCredentialType('slackApi')).toThrow(
				'Only "sapManagedApi" credentials can be created on this instance',
			);
		});
	});
});
