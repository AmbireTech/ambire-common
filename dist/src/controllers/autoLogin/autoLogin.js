"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoLoginController = exports.AUTO_LOGIN_DURATION_OPTIONS = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const tldts_1 = require("tldts");
const viem_1 = require("viem");
const siwe_1 = require("@signinwithethereum/siwe");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const signMessage_1 = require("../signMessage/signMessage");
exports.STATUS_WRAPPED_METHODS = {
    revokePolicy: 'INITIAL',
    revokeAllPoliciesForDomain: 'INITIAL'
};
// Taken from viem's parseSiweMessage.ts
const prefixRegex = /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/;
/**
 * A list of default policies for popular apps
 */
const DEFAULT_POLICIES = [];
const DEFAULT_AUTO_LOGIN_DURATION_OPTION = {
    label: '30 days',
    value: 30 * 24 * 60 * 60 * 1000
};
// Implemented here to ensure consistency between the controller and the UI
// Also, in the future when the duration setting becomes exposed to the UI we
// will need to validate the input from the UI, so these will be useful
exports.AUTO_LOGIN_DURATION_OPTIONS = [
    { label: '24 hours', value: 24 * 60 * 60 * 1000 },
    {
        label: '7 days',
        value: 7 * 24 * 60 * 60 * 1000
    },
    {
        label: '14 days',
        value: 14 * 24 * 60 * 60 * 1000
    },
    DEFAULT_AUTO_LOGIN_DURATION_OPTION
];
/**
 * The controller handles SIWE-like messages and provides auto-login functionality.
 * It creates and manages auto-login policies based on signed SIWE messages, and
 * automatically signs messages when auto-login is applicable.
 * In essence, it implements:
 * - ERC-4361: Sign-In with Ethereum (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-4361.md)
 * - ERC-8019: Auto-Login for SIWE (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-8019.md)
 */
class AutoLoginController extends eventEmitter_1.default {
    #storage;
    settings = {
        enabled: true,
        duration: DEFAULT_AUTO_LOGIN_DURATION_OPTION.value
    };
    #signMessage;
    #policiesByAccount = {};
    #accounts;
    #networks;
    #keystore;
    initialLoadPromise;
    statuses = exports.STATUS_WRAPPED_METHODS;
    constructor(storage, keystore, providers, networks, accounts, externalSignerControllers, invite, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#networks = networks;
        this.#signMessage = new signMessage_1.SignMessageController(keystore, providers, networks, accounts, externalSignerControllers, invite);
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    static isExpiredPolicy(policy) {
        // Policies with 0 expiration never expire
        if (policy.expiresAt === 0)
            return false;
        return Date.now() > policy.expiresAt;
    }
    static convertSiweToViemFormat(parsedSiweMessage) {
        const { expirationTime, notBefore, issuedAt, address, ...viemFormatParsedMessage } = parsedSiweMessage;
        const parsedSiweMessageViemFormat = {
            ...viemFormatParsedMessage,
            version: parsedSiweMessage.version, // hack to stop viem from whining
            // Always convert the address to a checksummed address because all checks later on assume that the address is checksummed.
            address: (0, viem_1.getAddress)(parsedSiweMessage.address),
            ...(parsedSiweMessage.expirationTime
                ? { expirationTime: new Date(parsedSiweMessage.expirationTime) }
                : {}),
            ...(parsedSiweMessage.notBefore ? { notBefore: new Date(parsedSiweMessage.notBefore) } : {}),
            ...(parsedSiweMessage.issuedAt ? { issuedAt: new Date(parsedSiweMessage.issuedAt) } : {})
        };
        return parsedSiweMessageViemFormat;
    }
    static getParsedSiweMessage(message, requestOrigin) {
        if (typeof message !== 'string' || message.trim() === '')
            return null;
        let messageString;
        try {
            messageString = message.startsWith('0x') ? (0, ethers_1.toUtf8String)(message) : message;
            // Quick check to see if it looks like a SIWE message at all
            if (messageString.match(prefixRegex) === null)
                return null;
        }
        catch (e) {
            return null;
        }
        try {
            const requestHostname = new URL(requestOrigin).host;
            const parsedSiweMessage = new siwe_1.SiweMessage(messageString);
            if (!parsedSiweMessage || !Object.keys(parsedSiweMessage).length)
                return null;
            if ((0, tldts_1.getDomain)(parsedSiweMessage.domain) !== (0, tldts_1.getDomain)(requestHostname))
                return {
                    parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
                    status: 'domain-mismatch'
                };
            if (parsedSiweMessage.notBefore &&
                new Date(parsedSiweMessage.notBefore).getTime() > Date.now())
                return {
                    parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
                    status: 'invalid'
                };
            if (parsedSiweMessage.expirationTime &&
                new Date(parsedSiweMessage.expirationTime).getTime() < Date.now())
                return {
                    parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
                    status: 'invalid'
                };
            if (!(0, ethers_1.isHexString)(parsedSiweMessage.address))
                return {
                    parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
                    status: 'invalid'
                };
            return {
                parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
                status: 'valid'
            };
        }
        catch (e) {
            console.error('Error parsing message:', e, 'Original message:', messageString);
            // Fallback to regular sign message if parsing fails
            return null;
        }
    }
    static isPolicyMatchingDomainAndUri(parsedSiwe, policy) {
        return policy.domain === parsedSiwe.domain && parsedSiwe.uri.startsWith(policy.uriPrefix);
    }
    async #load() {
        this.#policiesByAccount = await this.#storage.get('autoLoginPolicies', this.#policiesByAccount);
        this.settings = await this.#storage.get('autoLoginSettings', this.settings);
        this.emitUpdate();
    }
    #createOrUpdatePolicyFromSiwe(parsedSiwe, options) {
        // autoLoginDuration is defined always, but we are fallbacking just in case
        const autoLoginDuration = options.autoLoginDuration || this.settings.duration;
        const expirationTime = Date.now() + autoLoginDuration;
        const accountAddress = parsedSiwe.address;
        if (!this.#policiesByAccount[accountAddress]) {
            this.#policiesByAccount[accountAddress] = [];
        }
        const accountPolicies = this.#policiesByAccount[accountAddress];
        const existingPolicy = accountPolicies.find((p) => AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p));
        // Add a new policy
        if (!existingPolicy) {
            const newPolicy = {
                domain: parsedSiwe.domain,
                uriPrefix: parsedSiwe.uri,
                allowedChains: parsedSiwe.chainId ? [parsedSiwe.chainId] : [],
                allowedResources: parsedSiwe.resources || [],
                // @TODO: consider when to set to true
                supportsEIP6492: false,
                expiresAt: expirationTime,
                lastAuthenticated: Date.now()
            };
            this.#policiesByAccount[accountAddress].push(newPolicy);
            return newPolicy;
        }
        // Update existing policy
        existingPolicy.expiresAt = expirationTime;
        existingPolicy.lastAuthenticated = Date.now();
        if (!existingPolicy.allowedChains.includes(parsedSiwe.chainId)) {
            existingPolicy.allowedChains.push(parsedSiwe.chainId);
        }
        if (parsedSiwe.resources) {
            existingPolicy.allowedResources = Array.from(new Set([...existingPolicy.allowedResources, ...parsedSiwe.resources]));
        }
        return existingPolicy;
    }
    #getPolicyStatus(parsedSiwe, accountKeys, account) {
        // disable the auto login for Safe accounts
        if (account.safeCreation)
            return 'unsupported';
        const accountPolicies = this.getAccountPolicies(parsedSiwe.address);
        let policy = accountPolicies.find((p) => {
            if (!AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p))
                return false;
            if (parsedSiwe.chainId && !p.allowedChains.includes(parsedSiwe.chainId))
                return false;
            // Either all resources must be present and be a subset of the allowed resources,
            // or no resources should be present at all
            if (!parsedSiwe.resources || parsedSiwe.resources.length === 0)
                return true;
            return parsedSiwe.resources.every((resource) => p.allowedResources.includes(resource));
        });
        if (!policy) {
            // Check default policies
            const defaultPolicy = DEFAULT_POLICIES.find((p) => AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p));
            if (defaultPolicy)
                policy = this.getPolicyFromDefaultPolicy(defaultPolicy);
        }
        // @TODO: This will always be false if the policy doesn't exist??? Maybe we should
        // store the flag somewhere else
        if (!accountKeys.length ||
            (accountKeys.find((k) => k.type !== 'internal') && !policy?.supportsEIP6492))
            return 'unsupported';
        if (!policy)
            return 'no-policy';
        if (AutoLoginController.isExpiredPolicy(policy))
            return 'expired';
        return 'valid-policy';
    }
    async revokePolicy(accountAddress, policyDomain, policyUriPrefix) {
        await this.initialLoadPromise;
        await this.withStatus('revokePolicy', async () => {
            const accountPolicies = this.#policiesByAccount[accountAddress] || [];
            if (accountPolicies.length === 0)
                return;
            this.#policiesByAccount[accountAddress] = accountPolicies.filter((p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix));
            await this.#storage.set('autoLoginPolicies', this.#policiesByAccount);
        });
    }
    async revokeAllPoliciesForDomain(policyDomain, policyUriPrefix) {
        await this.initialLoadPromise;
        await this.withStatus('revokeAllPoliciesForDomain', async () => {
            Object.keys(this.#policiesByAccount).forEach((accountAddress) => {
                const accountPolicies = this.#policiesByAccount[accountAddress] || [];
                if (accountPolicies.length === 0)
                    return;
                this.#policiesByAccount[accountAddress] = accountPolicies.filter((p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix));
            });
            await this.#storage.set('autoLoginPolicies', this.#policiesByAccount);
        });
    }
    async onSiweMessageSigned(parsedSiwe, isAutoLoginEnabledByUser, autoLoginDuration) {
        await this.initialLoadPromise;
        if (!isAutoLoginEnabledByUser)
            return null;
        // If there is a default policy skip creating a new one
        // The only downside is that we don't save the lastAuthenticated time
        if (DEFAULT_POLICIES.find((p) => AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p))) {
            return null;
        }
        const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe, { autoLoginDuration });
        await this.#storage.set('autoLoginPolicies', this.#policiesByAccount);
        this.emitUpdate();
        return policy;
    }
    getAutoLoginStatus(parsedSiwe) {
        const accountData = this.#accounts.accounts.find((a) => a.addr === parsedSiwe.address);
        if (!accountData)
            throw new Error('Account not found');
        const accountKeys = this.#keystore.getAccountKeys(accountData);
        const policyStatus = this.#getPolicyStatus(parsedSiwe, accountKeys, accountData);
        switch (policyStatus) {
            case 'valid-policy':
                return 'active';
            case 'no-policy':
                return 'no-policy';
            case 'unsupported':
                return 'unsupported';
            case 'expired':
                return 'expired';
            default:
                throw new Error('Unrecognized policy status');
        }
    }
    async autoLogin(messageToSign) {
        await this.initialLoadPromise;
        const accountData = this.#accounts.accounts.find((a) => a.addr === messageToSign.accountAddr);
        if (!accountData)
            throw new Error('Account not found');
        const accountKeys = this.#keystore.getAccountKeys(accountData);
        const key = accountKeys.find((k) => k.type === 'internal');
        if (!key)
            throw new Error('No internal key available for signing');
        await this.#signMessage.init({
            messageToSign: {
                accountAddr: messageToSign.accountAddr,
                chainId: messageToSign.chainId,
                content: {
                    kind: 'message',
                    message: messageToSign.message
                },
                fromRequestId: 'siwe-auto-login',
                signature: null
            }
        });
        this.#signMessage.setSigners([{ addr: key.addr, type: key.type }]);
        await this.#signMessage.sign();
        return this.#signMessage.signedMessage;
    }
    getPolicyFromDefaultPolicy(defaultPolicy) {
        return {
            ...defaultPolicy,
            allowedChains: this.#networks.networks.map((n) => Number(n.chainId))
        };
    }
    getAccountPolicyForOrigin(accountAddr, origin, chainId) {
        const accountPolicies = this.getAccountPolicies(accountAddr);
        const policy = accountPolicies.find((p) => {
            try {
                const url = new URL(p.uriPrefix);
                return url.origin === origin;
            }
            catch {
                return false;
            }
        });
        if (!policy ||
            AutoLoginController.isExpiredPolicy(policy) ||
            (chainId && !policy.allowedChains.includes(chainId)))
            return null;
        if (policy)
            return policy;
        // Check for default policies first
        const defaultPolicy = DEFAULT_POLICIES.find((p) => {
            try {
                const url = new URL(p.uriPrefix);
                return url.origin === origin;
            }
            catch {
                return false;
            }
        });
        if (defaultPolicy)
            return this.getPolicyFromDefaultPolicy(defaultPolicy);
        return null;
    }
    getAccountPolicies(accountAddr, withDefaultPolicies = false) {
        const accountPolicies = this.#policiesByAccount[accountAddr] || [];
        if (!withDefaultPolicies)
            return accountPolicies;
        const defaultPoliciesConverted = DEFAULT_POLICIES.map((p) => this.getPolicyFromDefaultPolicy(p));
        return [...accountPolicies, ...defaultPoliciesConverted];
    }
}
exports.AutoLoginController = AutoLoginController;
//# sourceMappingURL=autoLogin.js.map