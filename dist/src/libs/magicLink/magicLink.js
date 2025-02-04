export async function requestMagicLink(email, relayerUrl, fetch, options) {
    const flow = options?.flow;
    const resp = await fetch(`${relayerUrl}/email-vault/request-key/${email}${flow ? `?flow=${flow}` : ''}`);
    const result = await resp.json();
    if (result?.data?.secret && options?.autoConfirm)
        setTimeout(() => {
            fetch(`${relayerUrl}/email-vault/confirm-key/${email}/${result.data.key}/${result.data.secret}`);
        }, 2000);
    if (!result.success)
        throw new Error(`magicLink: error getting magic link: ${result.message}`);
    return result.data;
}
//# sourceMappingURL=magicLink.js.map