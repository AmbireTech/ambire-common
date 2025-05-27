import { Fetch } from '../../interfaces/fetch';
export interface QueueElement {
    resolve: Function;
    reject: Function;
    fetch: Fetch;
    data: {
        [key: string]: any;
    };
    linkedDuplicates?: QueueElement[];
}
export interface Request {
    url: string;
    queueSegment: QueueElement[];
}
export type RequestGenerator = (queue: QueueElement[]) => Request[];
export default function batcher(fetch: Fetch, requestGenerator: RequestGenerator, options: {
    timeoutSettings?: {
        timeoutAfter: number;
        timeoutErrorMessage: string;
    };
    batchDebounce?: number;
    dedupeByKeys?: string[];
}): Function;
//# sourceMappingURL=batcher.d.ts.map