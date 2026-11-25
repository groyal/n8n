import type { INode, INodeProperties } from 'n8n-workflow';

import {
	addManagedOrdId,
	fillManagedPlaceholders,
	readManagedOrdId,
	rememberManagedOrdId,
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

	describe('readManagedOrdId', () => {
		it('reads the ORD ID from the node credential reference, with no stored record', () => {
			const slack = {
				...node(),
				credentials: {
					sapManagedApi: { id: null, name: 'Slack', ordId: 'sap:apiResource:SLACK:v1' },
				},
			};
			expect(readManagedOrdId(slack, 'sapManagedApi')).toBe('sap:apiResource:SLACK:v1');
		});

		it('returns nothing when the reference has no ORD ID', () => {
			const noOrdId = { ...node(), credentials: { sapManagedApi: { id: null, name: 'Slack' } } };
			expect(readManagedOrdId(noOrdId, 'sapManagedApi')).toBeUndefined();
			expect(readManagedOrdId(node(), 'sapManagedApi')).toBeUndefined();
		});

		it('ignores an ORD ID on another credential type', () => {
			const other = {
				...node(),
				credentials: { slackApi: { id: '1', name: 'Slack', ordId: 'sap:apiResource:SLACK:v1' } },
			};
			expect(readManagedOrdId(other, 'sapManagedApi')).toBeUndefined();
		});
	});

	describe('addManagedOrdId', () => {
		it('adds the ORD ID that the linked credential holds', () => {
			const slack = node();
			rememberManagedOrdId(slack, 'sap:apiResource:SLACK:v1');
			expect(addManagedOrdId(slack, { headers: { a: '1' } }).headers).toEqual({
				a: '1',
				ordID: 'sap:apiResource:SLACK:v1',
			});
		});

		it('overrides an ordID header that the node set', () => {
			const slack = node();
			rememberManagedOrdId(slack, 'sap:apiResource:SLACK:v1');
			expect(addManagedOrdId(slack, { headers: { ordID: 'typed' } }).headers).toEqual({
				ordID: 'sap:apiResource:SLACK:v1',
			});
		});

		it('changes nothing for a node that read no managed credential', () => {
			const options = { headers: { ordID: 'from-workflow' } };
			expect(addManagedOrdId(node(), options)).toBe(options);
		});

		it('ignores an empty ORD ID', () => {
			const slack = node();
			rememberManagedOrdId(slack, '');
			const options = { headers: {} };
			expect(addManagedOrdId(slack, options)).toBe(options);
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
