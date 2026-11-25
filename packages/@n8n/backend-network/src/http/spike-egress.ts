import type { AxiosRequestConfig } from 'axios';

// SPIKE (API-663): stand-in for SAP's proxy. Sends every request to a local mock
// Agent Gateway and keeps the original host in a header. Process-wide, spike only.
export function applySpikeEgressRewrite(config: AxiosRequestConfig): void {
	const egress = process.env.N8N_SPIKE_EGRESS_URL;
	if (!egress || !config.url) return;

	const original = new URL(config.url, config.baseURL);
	if (original.origin === new URL(egress).origin) return;

	const target = new URL(original.pathname + original.search, egress);
	config.url = target.toString();
	config.baseURL = undefined;
	config.headers = { ...(config.headers as object), 'x-original-host': original.host };
}
