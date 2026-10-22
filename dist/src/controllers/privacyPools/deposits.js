"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyPoolsDeposits = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const privacyPools_1 = require("../../consts/privacyPools");
const deposit_1 = require("../../libs/privacyPools/deposit");
const entrypointAssetConfig_1 = require("../../libs/privacyPools/entrypointAssetConfig");
const constants_1 = require("../../services/socket/constants");
const context_1 = require("./context");
const errors_1 = require("./errors");
/** How long a broadcast deposit blocks another into the same account. See `#broadcastDeposits`. */
const DEPOSIT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000;
const ERC20_INTERFACE = new ethers_1.Interface([
    'function approve(address spender, uint256 amount)',
    'function allowance(address owner, address spender) view returns (uint256)'
]);
const readDepositPrecommitment = (data) => (0, deposit_1.readPrivacyPoolsDeposit)({ data, value: 0n })?.precommitment ?? null;
/** Deposits into Privacy Pools accounts: building them, and recognising them once broadcast. */
class PrivacyPoolsDeposits {
    #ctx;
    #registry;
    #sync;
    /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
    assetConfigs = {};
    /** Per `${chainId}:${seedId}`. See `#getNextDepositPrecommitment`. */
    #nextDepositPrecommitments = new Map();
    /** Deposits `buildCalls` prepared, by precommitment, so a broadcast can be recognised. */
    #preparedDeposits = new Map();
    /**
     * Broadcast time per precommitment. A second deposit before the first lands would reuse its
     * precommitment, which the entrypoint rejects - so it is refused for a fixed window rather than
     * until seen on chain, which a never-landing broadcast would block forever.
     */
    #broadcastDeposits = new Map();
    constructor(ctx, registry, sync) {
        this.#ctx = ctx;
        this.#registry = registry;
        this.#sync = sync;
    }
    /**
     * The deposit calls, once the controller has checked the account, the lock and the chain.
     * See `PrivacyPoolsController.buildDepositCalls`.
     */
    async buildCalls({ seedId, accountAddr, chainId, tokenAddress, amount }) {
        const config = (0, context_1.getChainConfig)(chainId);
        const asset = (0, privacyPools_1.getPrivacyPoolsDepositAsset)(BigInt(chainId), tokenAddress);
        if (!asset)
            throw errors_1.privacyPoolsErrors.depositUnsupportedToken(tokenAddress, chainId);
        if (amount > asset.maxDeposit)
            throw errors_1.privacyPoolsErrors.depositAboveMaximum(asset.maxDeposit, asset);
        const { minimumDepositAmount, poolAddress } = await this.loadAssetConfig(chainId, tokenAddress);
        if (amount < minimumDepositAmount)
            throw errors_1.privacyPoolsErrors.depositBelowMinimum(minimumDepositAmount, asset);
        // A pool the paymaster has no adapter for, e.g. one 0xBow replaced, could not be sent out of
        // until an update adds it, so the funds would wait for that update.
        if (!config.paymaster?.poolAdapters[poolAddress.toLowerCase()])
            throw errors_1.privacyPoolsErrors.depositUnsupportedPool(asset.symbol, poolAddress);
        const precommitment = await this.#getNextDepositPrecommitment(chainId, seedId);
        if (this.#isDepositAwaitingChain(precommitment))
            throw errors_1.privacyPoolsErrors.depositAwaitingChain();
        this.#preparedDeposits.set(precommitment, { seedId, chainId });
        const depositCall = {
            to: config.entrypointAddress,
            ...(0, deposit_1.encodePrivacyPoolsDeposit)({
                isNative: asset.isNative,
                assetAddress: asset.address,
                amount,
                precommitment
            })
        };
        if (asset.isNative)
            return [depositCall];
        return [...(await this.#approvalCallIfNeeded(chainId, asset, amount, accountAddr)), depositCall];
    }
    /** Reads the entrypoint's deposit requirements for an asset once, into `assetConfigs`. */
    async loadAssetConfig(chainId, tokenAddress) {
        const key = `${chainId}:${tokenAddress.toLowerCase()}`;
        const loaded = this.assetConfigs[key];
        if (loaded)
            return loaded;
        const config = (0, context_1.getChainConfig)(chainId);
        try {
            const assetConfig = await (0, entrypointAssetConfig_1.readEntrypointAssetConfig)({
                provider: (0, context_1.getChainProvider)(this.#ctx.providers, chainId),
                entrypointAddress: config.entrypointAddress,
                assetAddress: (0, privacyPools_1.toPrivacyPoolsAssetAddress)(tokenAddress)
            });
            this.assetConfigs = { ...this.assetConfigs, [key]: assetConfig };
            this.#ctx.emitUpdate();
            return assetConfig;
        }
        catch (error) {
            throw errors_1.privacyPoolsErrors.depositAssetConfigReadFailed(error);
        }
    }
    /**
     * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
     * those `buildCalls` prepared are recognised, by precommitment - others are not this wallet's.
     * Nothing is persisted, as a local log would link deposits to their withdrawals.
     */
    onAccountOpBroadcast({ chainId, calls }) {
        const config = (0, privacyPools_1.getPrivacyPoolsChainConfig)(chainId);
        if (!config)
            return;
        calls
            .filter((call) => call.to?.toLowerCase() === config.entrypointAddress.toLowerCase())
            .map((call) => (0, deposit_1.readPrivacyPoolsDeposit)(call))
            .filter((deposit) => !!deposit)
            .filter(({ precommitment }) => this.#preparedDeposits.get(precommitment)?.chainId === chainId.toString())
            .forEach(({ precommitment }) => this.#broadcastDeposits.set(precommitment, Date.now()));
    }
    hasPhraseDerivedState() {
        return !!this.#nextDepositPrecommitments.size;
    }
    /** Keeps its prepared and broadcast deposits, for the reason given in `clear`. */
    forgetSeed(seedId) {
        this.#nextDepositPrecommitments.forEach((entry, key) => {
            if (entry.seedId === seedId)
                this.#nextDepositPrecommitments.delete(key);
        });
    }
    /**
     * Drops the precommitments derived ahead. Prepared and broadcast deposits are kept, as one made
     * before a lock may be broadcast or land after it: it must still be recognised, and still block
     * another deposit from reusing its precommitment.
     */
    clear() {
        this.#nextDepositPrecommitments.clear();
    }
    /**
     * The next deposit's precommitment. It depends on the phrase's deposit count, not the amount, so
     * it is derived once per sync (deriving needs a sync first). Taken from an SDK-built deposit only
     * if that goes to the configured entrypoint.
     */
    #getNextDepositPrecommitment(chainId, seedId) {
        const key = `${chainId}:${seedId}`;
        const cached = this.#nextDepositPrecommitments.get(key);
        const isCachedCurrent = !!cached && (cached.epoch === null || cached.epoch === this.#sync.getEpoch(chainId, seedId));
        if (cached && isCachedCurrent)
            return cached.derivation;
        const entry = {
            seedId,
            derivation: Promise.resolve(0n),
            epoch: null
        };
        const derivation = (async () => {
            const config = (0, context_1.getChainConfig)(chainId);
            // prepareShield syncs anyway, so a chain already on this device only waits for a running
            // sync. A new chain still goes through the queue, which reads its history once.
            if (await this.#registry.isChainCold(config))
                await this.#sync.queue(chainId, seedId);
            else
                await this.#sync.getRunningSync(seedId, chainId);
            // Pinned to the latest finished sync
            entry.epoch = this.#sync.getEpoch(chainId, seedId);
            const protocol = await this.#registry.getProtocol(chainId, seedId);
            const { txns } = await protocol.prepareShield({
                asset: { __type: 'erc20', contract: (0, privacyPools_1.toPrivacyPoolsAssetAddress)(constants_1.ZERO_ADDRESS) },
                amount: 1n
            });
            const [txn] = txns;
            if (!txn || txn.to.toLowerCase() !== config.entrypointAddress.toLowerCase())
                throw new Error('privacyPools: the prepared deposit does not go to the entrypoint');
            const precommitment = readDepositPrecommitment(txn.data);
            if (precommitment === null)
                throw new Error('privacyPools: the prepared deposit is not an entrypoint deposit');
            return precommitment;
        })();
        entry.derivation = derivation;
        this.#nextDepositPrecommitments.set(key, entry);
        // Not cached on failure, so the next attempt retries
        derivation.catch(() => {
            if (this.#nextDepositPrecommitments.get(key) === entry)
                this.#nextDepositPrecommitments.delete(key);
        });
        return derivation.catch((error) => {
            if (error instanceof EmittableError_1.default)
                throw error;
            throw errors_1.privacyPoolsErrors.depositPreparationFailed(error);
        });
    }
    #isDepositAwaitingChain(precommitment) {
        const broadcastAt = this.#broadcastDeposits.get(precommitment);
        return !!broadcastAt && Date.now() - broadcastAt < DEPOSIT_CONFIRMATION_WINDOW_MS;
    }
    /**
     * The approval `Entrypoint.deposit`'s `transferFrom` needs, which the SDK does not build. A
     * leftover allowance is reset to zero first, as USDT refuses non-zero to non-zero.
     */
    async #approvalCallIfNeeded(chainId, asset, amount, owner) {
        const config = (0, context_1.getChainConfig)(chainId);
        // Not an ethers `Contract`, whose generated methods are untyped
        const allowanceResult = await (0, context_1.getChainProvider)(this.#ctx.providers, chainId).call({
            to: asset.address,
            data: ERC20_INTERFACE.encodeFunctionData('allowance', [owner, config.entrypointAddress])
        });
        const allowance = ERC20_INTERFACE.decodeFunctionResult('allowance', allowanceResult)[0];
        if (allowance >= amount)
            return [];
        const approve = (value) => ({
            to: asset.address,
            value: 0n,
            data: ERC20_INTERFACE.encodeFunctionData('approve', [config.entrypointAddress, value])
        });
        return allowance ? [approve(0n), approve(amount)] : [approve(amount)];
    }
}
exports.PrivacyPoolsDeposits = PrivacyPoolsDeposits;
//# sourceMappingURL=deposits.js.map