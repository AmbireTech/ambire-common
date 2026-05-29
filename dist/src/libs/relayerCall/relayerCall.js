import { fetchWithTimeout } from '../../utils/fetch';
import { parse, stringify } from '../richJson/richJson';
export class RelayerError extends Error {
    input;
    output;
    isHumanized = false;
    constructor(message, input, output, isHumanized) {
        super(message);
        this.input = input;
        this.output = output;
        this.isHumanized = !!isHumanized;
    }
}
export const RELAYER_DOWN_MESSAGE = 'Currently, the Ambire relayer seems to be temporarily down. Please try again a few moments later';
export async function relayerCallUncaught(url, fetch, method = 'GET', body = null, headers = null, timeoutMs = 20000) {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
        return { success: false, message: 'bad method' };
    if (!url)
        return { success: false, message: 'no url or path' };
    if (body && ['GET', 'DELETE', 'HEAD'].includes(method))
        return { success: false, message: 'should not have a body' };
    const res = await fetchWithTimeout(fetch, url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: body ? stringify(body) : undefined
    }, timeoutMs);
    const text = await res.text();
    const isStatusOk = res.status < 300 && res.status >= 200;
    try {
        const json = parse(text);
        if (!json.hasOwnProperty('success')) {
            return { success: isStatusOk, ...json, status: res.status };
        }
        return { ...json, success: json.success && isStatusOk, status: res.status };
    }
    catch (e) {
        return {
            success: false,
            data: text,
            status: res.status,
            message: RELAYER_DOWN_MESSAGE
        };
    }
}
export async function relayerCall(path, method = 'GET', body = null, headers = null, timeoutMs = 20000) {
    if (!this.url || !this.fetch) {
        throw new RelayerError('Unable to connect to the Ambire relayer. Please try again later. Error code: RELAYERCALL_NOT_BINDED', { url: this.url, path, method, body, headers }, {}, true);
    }
    const res = await relayerCallUncaught(this.url + path, this.fetch, method, body, headers, timeoutMs);
    if (!res.success) {
        const firstError = res.errorState && res.errorState.length ? res.errorState[0] : res;
        throw new RelayerError(firstError.message, { url: this.url, path, method, body, headers }, { res }, firstError?.isHumanized || false);
    }
    return res;
}
//# sourceMappingURL=relayerCall.js.map