"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCaught = exports.fetchGet = exports.fetchPost = void 0;
async function fetchPost(_fetch, url, body) {
    const r = await _fetch(url, {
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        body: JSON.stringify(body)
    });
    return r.json();
}
exports.fetchPost = fetchPost;
async function fetchGet(_fetch, url) {
    const response = await _fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    if (response.status !== 200)
        throw new Error('Failed to fetch');
    return response.json();
}
exports.fetchGet = fetchGet;
async function fetchCaught(_fetch, url, params) {
    let resp;
    try {
        resp = await _fetch(url, params);
    }
    catch (e) {
        console.error(e);
        return { errMsg: `Unexpected error: ${e && e.message}` };
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (e) {
        console.error(e);
        return { errMsg: `Unexpected error: ${resp.status}, ${e && e.message}`, resp };
    }
    return { body, resp, errMsg: '' };
}
exports.fetchCaught = fetchCaught;
//# sourceMappingURL=fetch.js.map