import { getAddress, isAddress } from 'ethers';
import { getEnsAvatar, getIsNamoshiDomain, NAMOSHI_UNIVERSAL_RESOLVER, resolveENSDomain, reverseLookupEns } from '../../services/ensDomains';
import { withTimeout } from '../../utils/with-timeout';
import EventEmitter from '../eventEmitter/eventEmitter';
// 15 minutes
export const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000;
export const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter {
    #providers = {};
    #defaultNetworksMode = 'mainnet';
    /** Stores ENS names, avatars, and metadata (timestamps) indexed by account address */
    domains = {};
    /** Maps domain names to account addresses; necessary because the 'domains' state
     * only indexes by address, making getting an address for an existing domain name inefficient.
     * And is also problematic if a domain name that has been resolved doesn't have a corresponding address
     * (because no one owns it). We don't want to keep trying to resolve it every time.
     */
    domainToAddresses = {};
    loadingAddresses = [];
    resolveDomainsStatus = {};
    #reverseLookupPromises = {};
    constructor({ eventEmitterRegistry, providers, defaultNetworksMode }) {
        super(eventEmitterRegistry);
        this.#providers = providers;
        if (defaultNetworksMode)
            this.#defaultNetworksMode = defaultNetworksMode;
    }
    async batchReverseLookup(addresses) {
        const filteredAddresses = addresses.filter((address) => isAddress(address));
        await Promise.all(filteredAddresses.map((address) => this.reverseLookup(address, false)));
        this.emitUpdate();
    }
    /**
     * Resolves an ENS domain and persists it to state only if resolution succeeds.
     */
    async resolveDomain({ domain }) {
        const isNamoshiDomain = getIsNamoshiDomain(domain);
        const providerChainId = isNamoshiDomain
            ? '4114'
            : this.#defaultNetworksMode === 'mainnet'
                ? '1'
                : '11155111';
        const provider = this.#providers[providerChainId];
        if (!provider) {
            // Don't emit an error if the citrea provider is missing
            if (isNamoshiDomain)
                return;
            this.emitError({
                error: new Error('domains.resolveDomain: Ethereum provider is not available'),
                message: 'The RPC provider for Ethereum is not available.',
                level: 'major'
            });
            return;
        }
        if (this.resolveDomainsStatus[domain] === 'LOADING' ||
            this.resolveDomainsStatus[domain] === 'RESOLVED') {
            return;
        }
        this.resolveDomainsStatus[domain] = 'LOADING';
        await this.forceEmitUpdate();
        if (this.domainToAddresses[domain]) {
            this.resolveDomainsStatus[domain] = 'RESOLVED';
            await this.forceEmitUpdate();
            this.resolveDomainsStatus[domain] = undefined;
            return;
        }
        await resolveENSDomain({
            provider: provider,
            domain,
            options: isNamoshiDomain
                ? { universalResolverAddress: NAMOSHI_UNIVERSAL_RESOLVER }
                : undefined
        })
            .then(async ({ address, avatar }) => {
            if (address) {
                this.domainToAddresses[domain] = {
                    address: getAddress(address),
                    type: isNamoshiDomain ? 'namoshi' : 'ens'
                };
                this.#saveResolvedDomain({
                    address,
                    ensAvatar: avatar,
                    domain,
                    type: isNamoshiDomain ? 'namoshi' : 'ens'
                });
            }
            this.resolveDomainsStatus[domain] = 'RESOLVED';
            await this.forceEmitUpdate();
            this.resolveDomainsStatus[domain] = undefined;
        })
            .catch(async (e) => {
            console.error(`Failed to resolve ENS domain: ${domain}`, e);
            this.resolveDomainsStatus[domain] = 'FAILED';
            await this.forceEmitUpdate();
            this.resolveDomainsStatus[domain] = undefined;
        });
    }
    /**
     * Saves an already resolved ENS name for an address.
     */
    #saveResolvedDomain({ address, ensAvatar, domain, type }) {
        const checksummedAddress = getAddress(address);
        const { ens: prevEns } = this.domains[checksummedAddress] || { ens: null };
        const existing = this.domains[checksummedAddress];
        const now = Date.now();
        this.domains[checksummedAddress] = {
            ensAvatar: type === 'ens' ? ensAvatar : (existing?.ensAvatar ?? null),
            ens: type === 'ens' ? domain : prevEns,
            namoshi: type === 'namoshi' ? domain : (existing?.namoshi ?? null),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        };
    }
    async reverseLookup(address, emitUpdate = true) {
        if (this.#reverseLookupPromises[address]) {
            await this.#reverseLookupPromises[address];
            return;
        }
        this.#reverseLookupPromises[address] = this.#reverseLookup(address, emitUpdate).finally(() => {
            this.#reverseLookupPromises[address] = undefined;
        });
        await this.#reverseLookupPromises[address];
    }
    /**
     * Resolves the ENS names for an address if such exist.
     */
    async #reverseLookup(address, emitUpdate = true) {
        const ethereumProvider = this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111'];
        const citreaProvider = this.#providers['4114'];
        if (!ethereumProvider) {
            this.emitError({
                error: new Error('domains.reverseLookup: Ethereum provider is not available'),
                message: 'The RPC provider for Ethereum is not available.',
                level: 'major'
            });
            return;
        }
        const checksummedAddress = getAddress(address);
        const hasLastUpdateFailed = !!this.domains[checksummedAddress]?.updateFailedAt;
        const hasExpired = hasLastUpdateFailed
            ? Date.now() - (this.domains[checksummedAddress]?.updateFailedAt ?? 0) >
                PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS
            : Date.now() - (this.domains[checksummedAddress]?.updatedAt ?? 0) > PERSIST_DOMAIN_FOR_IN_MS;
        if (!hasExpired || this.loadingAddresses.includes(checksummedAddress))
            return;
        this.loadingAddresses.push(checksummedAddress);
        this.emitUpdate();
        try {
            let ensAvatar;
            const [ens, namoshi] = await Promise.all([
                withTimeout(() => reverseLookupEns(checksummedAddress, ethereumProvider), {
                    timeoutMs: 15000
                }),
                withTimeout(() => {
                    if (!citreaProvider)
                        return Promise.resolve(null);
                    return reverseLookupEns(checksummedAddress, citreaProvider, {
                        universalResolverAddress: NAMOSHI_UNIVERSAL_RESOLVER
                    }).catch((e) => {
                        const shortMessage = e?.cause?.shortMessage ?? e?.cause?.message ?? '';
                        // Ignore, the user simply doesn't have a namoshi domain
                        if (typeof shortMessage === 'string' && shortMessage.includes('data="0x77209fe8'))
                            return null;
                        console.warn('reverse Namoshi lookup failed', e);
                        return null;
                    });
                }, {
                    timeoutMs: 15000
                })
            ]);
            if (ens) {
                // We need the ens name to resolve the avatar
                ensAvatar = await withTimeout(() => getEnsAvatar(ens, ethereumProvider), {
                    timeoutMs: 15000
                });
                this.domainToAddresses[ens] = { address: checksummedAddress, type: 'ens' };
            }
            else if (namoshi && citreaProvider) {
                ensAvatar = await withTimeout(() => getEnsAvatar(namoshi, citreaProvider, {
                    universalResolverAddress: NAMOSHI_UNIVERSAL_RESOLVER
                }), {
                    timeoutMs: 15000
                });
                this.domainToAddresses[namoshi] = { address: checksummedAddress, type: 'namoshi' };
            }
            const now = Date.now();
            const existing = this.domains[checksummedAddress];
            this.domains[checksummedAddress] = {
                ens,
                namoshi,
                ensAvatar,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            };
        }
        catch (e) {
            const shortMessage = e?.cause?.shortMessage ?? e?.cause?.message ?? '';
            // Fail silently with a console error, no biggie, since that would get retried
            // Ignore, the user simply doesn't have a namoshi domain
            if (typeof shortMessage !== 'string' || !shortMessage.includes('data="0x77209fe8')) {
                console.warn('reverse ENS/Namoshi lookup failed for address', checksummedAddress, e);
            }
            const hasBeenResolvedOnce = !!this.domains[checksummedAddress]?.createdAt;
            if (hasBeenResolvedOnce) {
                this.domains[checksummedAddress].updateFailedAt = Date.now();
            }
            else {
                this.domains[checksummedAddress] = { ens: null, namoshi: null, updateFailedAt: Date.now() };
            }
        }
        this.loadingAddresses = this.loadingAddresses.filter((loadingAddress) => loadingAddress !== checksummedAddress);
        if (emitUpdate)
            this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON()
        };
    }
}
//# sourceMappingURL=domains.js.map