import { Service } from '@n8n/di';
import type { LifecycleEvent } from '@n8n/engine';

import { EngineV2LifecycleSubscriptions } from './engine-lifecycle-event-subscriptions';

type FinishedStatus = 'success' | 'error' | 'canceled';

export type EngineV2CompletionOutcome =
	| { kind: 'finished'; status: FinishedStatus }
	| { kind: 'timeout' }
	| { kind: 'aborted' };

type WaitOptions = { timeoutMs: number; abortSignal?: AbortSignal };

export interface EngineV2CompletionWatch {
	/**
	 * Resolves when the execution ends, the time runs out, or the signal aborts.
	 * Never rejects. Does not stop the watch, and does not cancel the run.
	 * `timeoutMs` is required: delivery is at-most-once, so the end can be lost.
	 */
	wait(options: WaitOptions): Promise<EngineV2CompletionOutcome>;
	/** Ends the watch. A pending wait still ends through its timeout or signal. */
	stop(): void;
}

const FINISHED_STATUS: Partial<Record<LifecycleEvent['type'], FinishedStatus>> = {
	'execution:completed': 'success',
	'execution:failed': 'error',
	'execution:cancelled': 'canceled',
};

class CompletionWatch implements EngineV2CompletionWatch {
	private status?: FinishedStatus;

	private ended = false;

	private removeListener?: () => void;

	private readonly waiters = new Set<(status: FinishedStatus) => void>();

	constructor(private readonly onEnd: () => void) {}

	/** The end can arrive before `listen` returns the remove function. */
	attach(removeListener: () => void): void {
		if (this.ended) removeListener();
		else this.removeListener = removeListener;
	}

	receive(event: LifecycleEvent): void {
		const status = FINISHED_STATUS[event.type];
		if (status === undefined || this.ended) return;

		this.status = status;
		this.stop();
		for (const settle of [...this.waiters]) settle(status);
	}

	async wait({ timeoutMs, abortSignal }: WaitOptions): Promise<EngineV2CompletionOutcome> {
		if (this.status) return { kind: 'finished', status: this.status };
		if (abortSignal?.aborted) return { kind: 'aborted' };

		return await new Promise((resolve) => {
			const settle = (outcome: EngineV2CompletionOutcome) => {
				clearTimeout(timer);
				abortSignal?.removeEventListener('abort', onAbort);
				this.waiters.delete(onFinish);
				resolve(outcome);
			};
			const onFinish = (status: FinishedStatus) => settle({ kind: 'finished', status });
			const onAbort = () => settle({ kind: 'aborted' });
			const timer = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs);
			abortSignal?.addEventListener('abort', onAbort, { once: true });
			this.waiters.add(onFinish);
		});
	}

	stop(): void {
		if (this.ended) return;

		this.ended = true;
		this.removeListener?.();
		this.onEnd();
	}
}

/**
 * Lets control-plane code wait for the end of an engine v2 execution without
 * polling. Events are not replayed, so watch the execution before it starts:
 *
 * ```ts
 * const executionId = createExecutionIdV2();
 * const watch = await completions.watch(executionId);
 * try {
 * 	await workflowRunner.run({ ...runData, engineV2ExecutionId: executionId });
 * 	const outcome = await watch.wait({ timeoutMs });
 * } finally {
 * 	watch.stop();
 * }
 * ```
 *
 * On `timeout` or `aborted`, the caller decides what to do with the run, and
 * reads the data plane for its status.
 */
@Service()
export class EngineV2ExecutionCompletions {
	/** The number of active watches of each execution. */
	private readonly watchCounts = new Map<string, number>();

	constructor(private readonly subscriptions: EngineV2LifecycleSubscriptions) {}

	/**
	 * Resolves once the subscription is active.
	 *
	 * @throws {OperationalError} If the subscription fails or times out.
	 */
	async watch(executionId: string): Promise<EngineV2CompletionWatch> {
		this.watchCounts.set(executionId, (this.watchCounts.get(executionId) ?? 0) + 1);
		const watch = new CompletionWatch(() => this.release(executionId));
		try {
			watch.attach(await this.subscriptions.listen(executionId, (event) => watch.receive(event)));
		} catch (error) {
			watch.stop();
			throw error;
		}

		return watch;
	}

	/** True from the call to `watch` until every watch of the execution has ended. */
	isWatching(executionId: string): boolean {
		return this.watchCounts.has(executionId);
	}

	private release(executionId: string): void {
		const count = this.watchCounts.get(executionId) ?? 0;
		if (count > 1) this.watchCounts.set(executionId, count - 1);
		else this.watchCounts.delete(executionId);
	}
}
