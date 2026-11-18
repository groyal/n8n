import type { IBinaryData, IBinaryKeyData } from 'n8n-workflow';

import type { InstanceAiContext } from '../../types';

/**
 * The file reads and writes that let a workflow run or a node run take
 * conversation files and return its files. Only hosts that store conversation
 * files set them.
 */
export function workflowFilesOf(context: InstanceAiContext) {
	const { storedFiles } = context;
	const readBinary = storedFiles?.readBinary?.bind(storedFiles);
	const storeWorkflowFile = storedFiles?.storeWorkflowFile?.bind(storedFiles);
	return readBinary && storeWorkflowFile ? { readBinary, storeWorkflowFile } : undefined;
}

export type WorkflowFiles = NonNullable<ReturnType<typeof workflowFilesOf>>;

/**
 * Resolve `files` (binary property name to fileId) to binary data entries.
 * Gives an error message for a fileId that the conversation does not have.
 */
export async function readInputFiles(
	workflowFiles: WorkflowFiles,
	files: Record<string, string> | undefined,
): Promise<{ binary?: IBinaryKeyData; error?: string }> {
	if (!files || Object.keys(files).length === 0) return {};
	const entries = new Map<string, IBinaryData>();
	for (const [key, fileId] of Object.entries(files)) {
		const entry = await workflowFiles.readBinary(fileId);
		if (!entry) return { error: `File "${fileId}" not found in this conversation` };
		entries.set(key, entry);
	}
	// A plain object would take a `__proto__` key as its prototype. `fromEntries` defines
	// own properties only, so no key from the model can change a prototype.
	return { binary: Object.fromEntries(entries) };
}
