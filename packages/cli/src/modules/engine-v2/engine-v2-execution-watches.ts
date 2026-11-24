import { Time } from '@n8n/constants';
import { Service } from '@n8n/di';
import type { LifecycleEvent } from '@n8n/engine';
import { UnexpectedError } from '@n8n/errors';
import type { TerminalExecutionStatus } from 'n8n-workflow';

import { EngineV2LifecycleSubscriptions } from './engine-lifecycle-event-subscriptions';

/** What a paused execution waits for, as its `execution:waiting` event reports it. */
export type EngineV2ExecutionWait = {
	at: string;
	awaitsRequest: boolean;
	awaitsSubExecution: boolean;
	lastDeadline?: string;
};

export type EngineV2WatchOutcome =
	| { kind: 'finished'; status: TerminalExecutionStatus }
	| { kind: 'waiting'; wait: EngineV2ExecutionWait }
	| { kind: 'timeout' }
	| { kind: 'aborted' };

export type EngineV2WatchWaitOptions = {
	timeoutMs: number;
	abortSignal?: AbortSignal;
	/**
	 * Called for each wait the execution reports. Return true to end this `wait`
	 * call with `waiting`. Without it, a wait never ends the call. A predicate
	 * that throws counts as false.
	 */
	stopWhenWaiting?: (wait: EngineV2ExecutionWait) => boolean;
};

const MAX_WAIT_TIMEOUT_MS = Time.days.toMilliseconds;

export interface EngineV2ExecutionWatch {
	/**
	 * Resolves when the execution ends, the time runs out, the signal aborts, the
	 * watch stops, or `stopWhenWaiting` accepts a wait. Does not stop the watch or
	 * cancel the run. `timeoutMs` is required: delivery is best effort, so the end
	 * event can be lost.
	 *
	 * @throws {UnexpectedError} If `timeoutMs` is more than 24 hours.
	 */
	wait(options: EngineV2WatchWaitOptions): Promise<EngineV2WatchOutcome>;
	/** Ends the watch and resolves each pending wait as `aborted`. */
	stop(): void;
}

const FINISHED_STATUS: Partial<Record<LifecycleEvent['type'], TerminalExecutionStatus>> = {
	'execution:completed': 'success',
	'execution:failed': 'error',
	'execution:cancelled': 'canceled',
};

function accepts(
	stopWhenWaiting: EngineV2WatchWaitOptions['stopWhenWaiting'],
	wait: EngineV2ExecutionWait,
): boolean {
	try {
		return stopWhenWaiting?.(wait) === true;
	} catch {
		return false;
	}
}

class ExecutionWatch implements EngineV2ExecutionWatch {
	private outcome?: EngineV2WatchOutcome;

	/** The latest wait that arrived while no `wait` call was pending. The next call gets it first. */
	private unofferedWait?: EngineV2ExecutionWait;

	private removeListener?: () => void;

	/** Each pending `wait` call, with its predicate. */
	private readonly waiters = new Map<
		(outcome: EngineV2WatchOutcome) => void,
		EngineV2WatchWaitOptions['stopWhenWaiting']
	>();

	constructor(private readonly onEnd: () => void) {}

	/** The end can arrive before `listen` returns the remove function. */
	attach(removeListener: () => void): void {
		if (this.outcome) removeListener();
		else this.removeListener = removeListener;
	}

	receive(event: LifecycleEvent): void {
		const status = FINISHED_STATUS[event.type];
		if (status !== undefined) {
			this.end({ kind: 'finished', status });
		} else if (event.type === 'execution:waiting') {
			const { type: _type, executionId: _executionId, workflowId: _workflowId, ...wait } = event;
			this.offer(wait);
		}
	}

	async wait({
		timeoutMs,
		abortSignal,
		stopWhenWaiting,
	}: EngineV2WatchWaitOptions): Promise<EngineV2WatchOutcome> {
		if (timeoutMs > MAX_WAIT_TIMEOUT_MS) {
			throw new UnexpectedError('The wait timeout must not be more than 24 hours', {
				extra: { timeoutMs },
			});
		}
		if (this.outcome) return this.outcome;
		if (abortSignal?.aborted) return { kind: 'aborted' };

		const wait = this.unofferedWait;
		this.unofferedWait = undefined;
		if (wait && accepts(stopWhenWaiting, wait)) return { kind: 'waiting', wait };

		return await new Promise((resolve) => {
			const settle = (outcome: EngineV2WatchOutcome) => {
				clearTimeout(timer);
				abortSignal?.removeEventListener('abort', onAbort);
				this.waiters.delete(settle);
				resolve(outcome);
			};
			const onAbort = () => settle({ kind: 'aborted' });
			const timer = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs).unref();
			abortSignal?.addEventListener('abort', onAbort, { once: true });
			this.waiters.set(settle, stopWhenWaiting);
		});
	}

	stop(): void {
		this.end({ kind: 'aborted' });
	}

	private offer(wait: EngineV2ExecutionWait): void {
		// Ignored after the end: events of different data-plane processes can arrive out of order.
		if (this.outcome) return;
		if (this.waiters.size === 0) {
			this.unofferedWait = wait;
			return;
		}

		for (const [settle, stopWhenWaiting] of [...this.waiters]) {
			if (accepts(stopWhenWaiting, wait)) settle({ kind: 'waiting', wait });
		}
	}

	private end(outcome: EngineV2WatchOutcome): void {
		if (this.outcome) return;

		this.outcome = outcome;
		this.removeListener?.();
		this.onEnd();
		for (const settle of [...this.waiters.keys()]) settle(outcome);
	}
}

/**
 * Lets control-plane code wait for the end of an engine v2 execution without
 * polling. Events are not replayed, so watch the execution before it starts.
 *
 * ```ts
 * const executionId = createExecutionIdV2();
 * const watch = await executionWatches.watch(executionId);
 * try {
 * 	await workflowRunner.run({ ...runData, engineV2ExecutionId: executionId });
 * 	const outcome = await watch.wait({ timeoutMs });
 * } finally {
 * 	watch.stop();
 * }
 * ```
 *
 * A run that pauses for outside input, such as a form or a webhook wait, sends
 * no end event. Pass `stopWhenWaiting` to end a `wait` call with `waiting`
 * instead. The watch continues, so a later `wait` call can still see the end.
 *
 * On `timeout` or `aborted`, the caller decides what to do with the run, and
 * reads the data plane for its status.
 */
@Service()
export class EngineV2ExecutionWatches {
	/** The number of active watches of each execution. */
	private readonly watchCounts = new Map<string, number>();

	constructor(private readonly subscriptions: EngineV2LifecycleSubscriptions) {}

	/**
	 * Resolves once the subscription is active.
	 *
	 * @throws {UnexpectedError} If the lifecycle event receiver is not set.
	 * @throws {OperationalError} If the subscription fails or times out.
	 */
	async watch(executionId: string): Promise<EngineV2ExecutionWatch> {
		this.watchCounts.set(executionId, (this.watchCounts.get(executionId) ?? 0) + 1);
		const watch = new ExecutionWatch(() => this.release(executionId));
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
