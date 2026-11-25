import type { INode, INodeProperties } from 'n8n-workflow';

import {
	addManagedOrdId,
	addRememberedOrdId,
	fillManagedPlaceholders,
	rememberManagedRequest,
	resolveManagedCredentialType,
} from '../managed-credential';

const node = (type = 'n8n-nodes-base.slack'): INode => ({
	id: '1',
	name: 'Node',
	type,
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
});

describe('managed credential (spike)', () => {
	afterEach(() => {
		delete process.env.N8N_MANAGED_CREDENTIAL_TYPE;
		delete process.env.N8N_SPIKE_ORD_ID_MAP;
	});

	describe('resolveManagedCredentialType', () => {
		it('keeps the requested type when managed mode is off', () => {
			expect(resolveManagedCredentialType(node(), 'slackApi')).toBe('slackApi');
		});

		it('resolves every type to the managed type when managed mode is on', () => {
			process.env.N8N_MANAGED_CREDENTIAL_TYPE = 'sapManagedApi';
			expect(resolveManagedCredentialType(node(), 'slackApi')).toBe('sapManagedApi');
			expect(resolveManagedCredentialType(node(), 'microsoftOutlookOAuth2Api')).toBe(
				'sapManagedApi',
			);
		});
	});

	describe('addManagedOrdId', () => {
		beforeEach(() => {
			process.env.N8N_SPIKE_ORD_ID_MAP = JSON.stringify({ slackApi: 'sap:apiResource:SLACK:v1' });
		});

		it('adds the fixed ORD ID of the requested type', () => {
			const options = addManagedOrdId(node(), 'slackApi', 'sapManagedApi', { headers: { a: '1' } });
			expect(options.headers).toEqual({ a: '1', ordID: 'sap:apiResource:SLACK:v1' });
		});

		it('overrides an ordID header that the node set', () => {
			const options = addManagedOrdId(node(), 'slackApi', 'sapManagedApi', {
				headers: { ordID: 'typed' },
			});
			expect(options.headers).toEqual({ ordID: 'sap:apiResource:SLACK:v1' });
		});

		it('changes nothing when the type was not swapped', () => {
			const options = { headers: { a: '1' } };
			expect(addManagedOrdId(node(), 'slackApi', 'slackApi', options)).toBe(options);
		});

		it('changes nothing when the type has no ORD ID', () => {
			const options = { headers: {} };
			expect(addManagedOrdId(node(), 'unknownApi', 'sapManagedApi', options)).toBe(options);
		});
	});

	describe('addRememberedOrdId', () => {
		it('adds the ORD ID for plain requests after the node read its credential', () => {
			process.env.N8N_SPIKE_ORD_ID_MAP = JSON.stringify({
				telegramApi: 'sap:apiResource:TELEGRAM:v1',
			});
			const telegram = node('n8n-nodes-base.telegram');
			expect(addRememberedOrdId(telegram, { headers: {} }).headers).toEqual({});

			rememberManagedRequest(telegram, 'telegramApi');
			expect(addRememberedOrdId(telegram, { headers: {} }).headers).toEqual({
				ordID: 'sap:apiResource:TELEGRAM:v1',
			});
		});
	});

	describe('fillManagedPlaceholders', () => {
		const property = (p: Partial<INodeProperties>): INodeProperties =>
			({ displayName: p.name, type: 'string', default: '', ...p }) as INodeProperties;

		it('uses the default, then the UI example, then a placeholder', () => {
			const filled = fillManagedPlaceholders(
				[
					property({ name: 'graphApiBaseUrl', default: 'https://graph.microsoft.com' }),
					property({ name: 'domain', placeholder: 'https://example.atlassian.net' }),
					property({ name: 'subdomain' }),
					property({ name: 'apiKey' }),
					property({ name: 'note', type: 'notice' }),
				],
				{},
			);
			expect(filled).toEqual({
				graphApiBaseUrl: 'https://graph.microsoft.com',
				domain: 'https://example.atlassian.net',
				subdomain: 'https://sap-managed.example.com',
				apiKey: 'sap-managed',
				note: '',
			});
		});

		it('leaves secret fields empty, so no stand-in secret leaves n8n', () => {
			const filled = fillManagedPlaceholders(
				[property({ name: 'accessToken', typeOptions: { password: true } })],
				{},
			);
			expect(filled).toEqual({ accessToken: '' });
		});

		it('keeps values stored in the managed credential', () => {
			const filled = fillManagedPlaceholders([property({ name: 'apiKey' })], { managedBy: 'sap' });
			expect(filled).toEqual({ apiKey: 'sap-managed', managedBy: 'sap' });
		});
	});
});
