/**
 * Static list of tokens to exclude from display, keyed by chainId.
 * Addresses MUST BE CHECKSUMMED.
 * Symbol patterns are matched case-insensitively as substrings.
 */
export const STATIC_BLACKLIST = {
    blacklistAddrs: {
        // Gnosis Chain (xDAI)
        '100': [
            '0xcB444e90D8198415266c6a2724b7900fb12FC56E' // EURe - Duplicate
        ],
        // Polygon
        '137': [
            '0x18ec0A6E18E5bc3784fDd3a3634b31245ab704F6', // EURe (Monerium EUR emoney) - Excluded due to regulatory restrictions and limited utility in the app
            '0x0B91B07bEb67333225A5bA0259D55AeE10E3A578' // MNEP - scam token
        ],
        // Ethereum Mainnet
        '1': [
            '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f' // EURe - Duplicate
        ],
        // Hyper EVM
        '999': [
            '0x94e8396e0869c9F2200760aF0621aFd240E1CF38' // wstHYPE - Excluded because it's a duplicate of stHYPE
        ],
        // Andromeda
        '1088': [
            '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000' // METIS as an ERC-20 token - Excluded because it's a duplicate of the native token
        ],
        // Optimism
        '10': [
            '0xDfA2d3a0d32F870D87f8A0d7AA6b9CdEB7bc5AdB' // sUSD - Duplicate of 0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9
        ]
    },
    blacklistBySymbols: ['https', 'www.']
};
export const filterStaticBlacklistedAddrs = (tokenAddrs, chainId) => {
    const staticBlacklistedAddrs = STATIC_BLACKLIST.blacklistAddrs[chainId.toString()] || [];
    if (!staticBlacklistedAddrs.length)
        return tokenAddrs;
    const staticBlacklistedAddrsLower = new Set(staticBlacklistedAddrs.map((addr) => addr.toLowerCase()));
    return tokenAddrs.filter((addr) => !staticBlacklistedAddrsLower.has(addr.toLowerCase()));
};
//# sourceMappingURL=blacklist.js.map