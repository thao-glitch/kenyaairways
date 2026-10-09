/** BullMQ queue: KCAA manifest dispatch (HTTP happens in the worker). */
export const MANIFEST_DISPATCH_QUEUE = 'manifest-dispatch';

export type ManifestDispatchJob = { dispatchId: string };
