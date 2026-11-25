import { mockInstance } from '@n8n/backend-test-utils';
import { UnexpectedError, UserError } from '@n8n/errors';
import type { IWorkflowExecutionDataProcess } from 'n8n-workflow';
import { mock } from 'vitest-mock-extended';

import {
	type EngineV2ExecutionWait,
	type EngineV2ExecutionWatch,
	EngineV2ExecutionWatches,
	type EngineV2WatchOutcome,
} from '@/modules/engine-v2/engine-v2-execution-watches';
import type { EngineDataPlaneProxyService } from '@/services/engine-data-plane-proxy.service';
import type { EngineV2Dispatcher } from '@/services/engine-v2-dispatcher.service';
import { EngineV2RunService } from '@/services/engine-v2-run.service';
import type { WorkflowRunner } from '@/workflow-runner';

const data = {
	executionMode: 'manual',
	workflowData: { id: 'wf-1' },
} as IWorkflowExecutionDataProcess;
const options = { timeoutMs: 1_000 };

const at = '2026-11-24T10:00:00.000Z';
const after = (ms: number) => new Date(Date.parse(at) + ms).toISOString();
const waitingFor = (wait: Partial<EngineV2ExecutionWait>): EngineV2WatchOutcome => ({
	kind: 'waiting',
	wait: { at, awaitsRequest: false, awaitsSubExecution: false, ...wait },
});

describe('EngineV2RunService', () => {
	const runner = mock<WorkflowRunner>();
	const dispatcher = mock<EngineV2Dispatcher>();
	const proxy = mock<EngineDataPlaneProxyService>();
	const watches = mockInstance(EngineV2ExecutionWatches);
	const watch = mock<EngineV2ExecutionWatch>();
	const runs = new EngineV2RunService(runner, dispatcher, proxy);

	/** The id the run got: the one `watch` was called with. */
	const watchedId = () => watches.watch.mock.calls[0][0];

	beforeEach(() => {
		vi.clearAllMocks();
		watch.wait.mockReset();
		dispatcher.routesToEngineV2.mockReturnValue(true);
		proxy.isAvailable.mockReturnValue(true);
		watches.watch.mockResolvedValue(watch);
		runner.run.mockImplementation(async ({ engineV2ExecutionId }) => engineV2ExecutionId ?? '');
		watch.wait.mockResolvedValue({ kind: 'finished', status: 'success' });
		proxy.cancelExecution.mockResolvedValue(undefined);
	});

	it('routes a run as the dispatcher does', () => {
		dispatcher.routesToEngineV2.mockReturnValue(false);

		expect(runs.routesToEngineV2(data)).toBe(false);
		expect(dispatcher.routesToEngineV2).toHaveBeenCalledWith(data);
	});

	it('refuses a run that does not go to engine v2 before anything starts', async () => {
		dispatcher.routesToEngineV2.mockReturnValue(false);

		await expect(runs.runAndWait(data, options)).rejects.toThrow(UnexpectedError);
		expect(watches.watch).not.toHaveBeenCalled();
		expect(runner.run).not.toHaveBeenCalled();
	});

	it('passes on the refusal of the runner, and watches nothing, when engine v2 is not available', async () => {
		proxy.isAvailable.mockReturnValue(false);
		const refusal = new UserError('Engine v2 is not available.');
		runner.run.mockRejectedValue(refusal);

		await expect(runs.runAndWait(data, options)).rejects.toBe(refusal);
		expect(watches.watch).not.toHaveBeenCalled();
		expect(runner.run).toHaveBeenCalledWith(data);
		expect(proxy.cancelExecution).not.toHaveBeenCalled();
	});

	it('throws an UnexpectedError when the runner starts a run although engine v2 is not available', async () => {
		proxy.isAvailable.mockReturnValue(false);
		runner.run.mockResolvedValue('exec-1');

		await expect(runs.runAndWait(data, options)).rejects.toThrow(UnexpectedError);
		expect(watches.watch).not.toHaveBeenCalled();
	});

	it('watches the execution before it starts the run under the same id', async () => {
		await runs.runAndWait(data, options);

		expect(watches.watch.mock.invocationCallOrder[0]).toBeLessThan(
			runner.run.mock.invocationCallOrder[0],
		);
		expect(runner.run).toHaveBeenCalledWith({ ...data, engineV2ExecutionId: watchedId() });
	});

	it.each<EngineV2WatchOutcome>([
		{ kind: 'finished', status: 'error' },
		{ kind: 'timeout' },
		{ kind: 'aborted' },
	])('returns the id and the outcome $kind of the wait', async (outcome) => {
		watch.wait.mockResolvedValue(outcome);

		const result = await runs.runAndWait(data, options);

		expect(result).toEqual({ executionId: watchedId(), outcome });
		expect(proxy.cancelExecution).not.toHaveBeenCalled();
	});

	describe('when the run starts to wait', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it.each<[string, Partial<EngineV2ExecutionWait>]>([
			['a request', { awaitsRequest: true }],
			['a request with a short deadline', { awaitsRequest: true, lastDeadline: after(1) }],
			['a deadline at the timeout', { lastDeadline: after(options.timeoutMs) }],
			[
				'a sub-execution with a deadline after the timeout',
				{ awaitsSubExecution: true, lastDeadline: after(10 * options.timeoutMs) },
			],
		])('returns paused when the run waits for %s', async (_name, wait) => {
			watch.wait.mockResolvedValueOnce(waitingFor(wait));

			const result = await runs.runAndWait(data, options);

			expect(result).toEqual({ executionId: watchedId(), outcome: { kind: 'paused' } });
			expect(watch.wait).toHaveBeenCalledTimes(1);
			expect(watch.stop).toHaveBeenCalledTimes(1);
		});

		it.each<[string, Partial<EngineV2ExecutionWait>]>([
			['a deadline before the timeout', { lastDeadline: after(options.timeoutMs - 1) }],
			['a sub-execution only', { awaitsSubExecution: true }],
		])('keeps waiting when the run waits for %s, and returns its end', async (_name, wait) => {
			watch.wait
				.mockResolvedValueOnce(waitingFor(wait))
				.mockResolvedValueOnce({ kind: 'finished', status: 'success' });

			const result = await runs.runAndWait(data, options);

			expect(result.outcome).toEqual({ kind: 'finished', status: 'success' });
			expect(watch.wait).toHaveBeenCalledTimes(2);
		});

		it('passes the abort signal to each wait, and only the time that is left to the next wait', async () => {
			const abortSignal = new AbortController().signal;
			watch.wait
				.mockImplementationOnce(async () => {
					vi.advanceTimersByTime(400);
					return waitingFor({ lastDeadline: after(100) });
				})
				.mockResolvedValueOnce({ kind: 'timeout' });

			const result = await runs.runAndWait(data, { timeoutMs: 1_000, abortSignal });

			expect(result.outcome).toEqual({ kind: 'timeout' });
			expect(watch.wait).toHaveBeenNthCalledWith(1, { timeoutMs: 1_000, abortSignal });
			expect(watch.wait).toHaveBeenNthCalledWith(2, { timeoutMs: 600, abortSignal });
		});
	});

	it('stops the watch after the wait ends', async () => {
		await runs.runAndWait(data, options);

		expect(watch.stop).toHaveBeenCalledTimes(1);
		expect(watch.wait.mock.invocationCallOrder[0]).toBeLessThan(
			watch.stop.mock.invocationCallOrder[0],
		);
	});

	it('cancels the new execution, stops the watch and passes on the error when the start fails', async () => {
		const failure = new Error('refused');
		runner.run.mockRejectedValue(failure);

		await expect(runs.runAndWait(data, options)).rejects.toBe(failure);
		expect(proxy.cancelExecution).toHaveBeenCalledWith(watchedId());
		expect(watch.stop).toHaveBeenCalledTimes(1);
		expect(watch.wait).not.toHaveBeenCalled();
	});

	it('passes on the start error when the cancel after a failed start fails too', async () => {
		const failure = new Error('start answer lost');
		runner.run.mockRejectedValue(failure);
		proxy.cancelExecution.mockRejectedValue(new Error('data plane down'));

		await expect(runs.runAndWait(data, options)).rejects.toBe(failure);
		expect(watch.stop).toHaveBeenCalledTimes(1);
	});

	it('starts no run when the watch fails', async () => {
		const failure = new Error('no subscription');
		watches.watch.mockRejectedValue(failure);

		await expect(runs.runAndWait(data, options)).rejects.toBe(failure);
		expect(runner.run).not.toHaveBeenCalled();
	});

	it('refuses a run that started under a different id, and stops the watch', async () => {
		runner.run.mockResolvedValue('other-id');

		await expect(runs.runAndWait(data, options)).rejects.toThrow(UnexpectedError);
		expect(watch.wait).not.toHaveBeenCalled();
		expect(watch.stop).toHaveBeenCalledTimes(1);
		expect(proxy.cancelExecution).not.toHaveBeenCalled();
	});
});
