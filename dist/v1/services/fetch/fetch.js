export async function fetchPost(_fetch, url, body) {
    const r = await _fetch(url, {
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        body: JSON.stringify(body)
    });
    return r.json();
}
export async function fetchGet(_fetch, url) {
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
export async function fetchCaught(_fetch, url, params) {
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
//# sourceMappingURL=fetch.js.map