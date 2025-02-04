import { Fetch } from '../../interfaces/fetch';
export interface QueueElement {
    resolve: Function;
    reject: Function;
    fetch: Fetch;
    data: any;
}
export interface Request {
    url: string;
    queueSegment: QueueElement[];
}
export type RequestGenerator = (queue: QueueElement[]) => Request[];
export default function batcher(fetch: Fetch, requestGenerator: RequestGenerator, timeoutSettings?: {
    timeoutAfter: number;
    timeoutErrorMessage: string;
}, batchDebounce?: number): Function;
//# sourceMappingURL=batcher.d.ts.map