import { Container, Service } from '@n8n/di';
import { UnexpectedError } from '@n8n/errors';
import type { IWorkflowExecutionDataProcess, TerminalExecutionStatus } from 'n8n-workflow';

import { createExecutionIdV2, type ExecutionIdV2 } from '@/executions/execution-id';
import type {
	EngineV2ExecutionWait,
	EngineV2ExecutionWatch,
	EngineV2WatchWaitOptions,
} from '@/modules/engine-v2/engine-v2-execution-watches';
import { EngineDataPlaneProxyService } from '@/services/engine-data-plane-proxy.service';
import { EngineV2Dispatcher } from '@/services/engine-v2-dispatcher.service';
import { WorkflowRunner } from '@/workflow-runner';

export type EngineV2RunOutcome =
	| { kind: 'finished'; status: TerminalExecutionStatus }
	| { kind: 'paused' }
	| { kind: 'timeout' }
	| { kind: 'aborted' };

/** A wait is a pause when no step can continue before the caller stops waiting. */
function isPause(wait: EngineV2ExecutionWait, remainingMs: number): boolean {
	if (wait.awaitsRequest) return true;
	if (wait.lastDeadline === undefined) return false;

	// Both times come from the data plane, so the clock of this process does not matter.
	return Date.parse(wait.lastDeadline) - Date.parse(wait.at) >= remainingMs;
}

/**
 * Starts engine v2 runs for control-plane code that waits for their end.
 * It is not part of {@link EngineV2Dispatcher}, because `WorkflowRunner`
 * depends on the dispatcher.
 */
@Service()
export class EngineV2RunService {
	constructor(
		private readonly runner: WorkflowRunner,
		private readonly dispatcher: EngineV2Dispatcher,
		private readonly proxy: EngineDataPlaneProxyService,
	) {}

	/** Whether a run of this data goes to engine v2. */
	routesToEngineV2(data: IWorkflowExecutionDataProcess): boolean {
		return this.dispatcher.routesToEngineV2(data);
	}

	/**
	 * Starts an engine v2 run and waits until it ends or pauses. The run pauses
	 * when it waits for a request, or for a deadline that is not before the
	 * timeout. A shorter wait does not end the call.
	 *
	 * It never reads the data plane. It cancels the run only when the start
	 * fails, because the data plane can save the run before the start fails. On
	 * `timeout` or `aborted`, the caller decides what to do with the run. Events
	 * can be lost, so after a `timeout` the caller reads the status from the data
	 * plane. A `paused` run can continue later, so the caller must not treat it
	 * as ended.
	 *
	 * @throws {UnexpectedError} If the run does not go to engine v2.
	 * @throws {OperationalError} If the watch cannot subscribe to the lifecycle events.
	 * @throws The errors of `WorkflowRunner.run` when the run does not start.
	 */
	async runAndWait(
		data: IWorkflowExecutionDataProcess,
		options: EngineV2WatchWaitOptions,
	): Promise<{ executionId: ExecutionIdV2; outcome: EngineV2RunOutcome }> {
		if (!this.routesToEngineV2(data)) {
			throw new UnexpectedError('Only a run that goes to engine v2 can be awaited');
		}

		if (!this.proxy.isAvailable()) {
			// The runner refuses the run, with the reason the user can act on.
			await this.runner.run(data);
			throw new UnexpectedError('Engine v2 started a run while it is not available');
		}

		// Lazily imported: the watches belong to the engine-v2 module.
		const { EngineV2ExecutionWatches } = await import(
			'@/modules/engine-v2/engine-v2-execution-watches.js'
		);
		const executionId = createExecutionIdV2();
		const watch = await Container.get(EngineV2ExecutionWatches).watch(executionId);
		try {
			const startedId = await this.start(data, executionId);
			if (startedId !== executionId) {
				throw new UnexpectedError('Engine v2 started the run under a different id', {
					extra: { executionId, startedId },
				});
			}

			return { executionId, outcome: await this.waitForEndOrPause(watch, options) };
		} finally {
			watch.stop();
		}
	}

	private async waitForEndOrPause(
		watch: EngineV2ExecutionWatch,
		{ timeoutMs, abortSignal }: EngineV2WatchWaitOptions,
	): Promise<EngineV2RunOutcome> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const outcome = await watch.wait({
				timeoutMs: Math.max(deadline - Date.now(), 0),
				abortSignal,
			});
			if (outcome.kind !== 'waiting') return outcome;
			if (isPause(outcome.wait, deadline - Date.now())) return { kind: 'paused' };
		}
	}

	private async start(data: IWorkflowExecutionDataProcess, executionId: ExecutionIdV2) {
		try {
			return await this.runner.run({ ...data, engineV2ExecutionId: executionId });
		} catch (error) {
			try {
				await this.proxy.cancelExecution(executionId);
			} catch {
				// Usually no run exists under this id.
			}
			throw error;
		}
	}
}
