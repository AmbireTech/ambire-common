import { JsonRpcProvider } from 'ethers'

import { BUNDLER } from '../consts/bundlers'
import {
  ChainlistNetwork,
  Erc4337settings,
  Network,
  NetworkFeature,
  RelayerNetwork
} from '../interfaces/network'

const checkIsRpcUrlWorking = async (rpcUrl: string) => {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    await provider.getBlockNumber()
  } catch {
    provider?.destroy()
    return false
  }

  provider.destroy()

  return true
}

const rollProviderUrlsAndFindWorking = async (
  rpcUrls: string[],
  index: number
): Promise<string | null> => {
  const isProviderWorking = await checkIsRpcUrlWorking(rpcUrls[index])

  if (isProviderWorking) {
    return rpcUrls[index]
  }

  const nextIndex = index + 1

  if (rpcUrls.length > nextIndex) {
    return rollProviderUrlsAndFindWorking(rpcUrls, nextIndex)
  }

  return null
}

const convertToAmbireNetworkFormat = async (network: ChainlistNetwork): Promise<Network> => {
  const freeHttpRpcUrls = network.rpc.filter((rpcUrl: string) => {
    const isHttpOrHttps = rpcUrl.startsWith('http')

    if (!isHttpOrHttps) return false

    const isApiKeyRequired = /${.+}/.test(rpcUrl)

    return !isApiKeyRequired
  })
  const workingRpcUrl = await rollProviderUrlsAndFindWorking(freeHttpRpcUrls, 0)

  let platformId = null
  let nativeAssetId = null

  try {
    const coingeckoRequest = await fetch(
      `https://cena.ambire.com/api/v3/platform/${Number(network.chainId)}`
    ).catch(() => ({
      error: 'currently, we cannot fetch the coingecko information'
    }))

    // set the coingecko info

    if (!('error' in coingeckoRequest)) {
      const coingeckoInfo = await coingeckoRequest.json()
      if (!coingeckoInfo.error) {
        platformId = coingeckoInfo.platformId
        nativeAssetId = coingeckoInfo.nativeAssetId
      }
    }
  } catch (e) {
    console.error(e)
    // do nothing
  }

  return {
    id: network.name.toLowerCase(),
    name: network.name,
    chainId: BigInt(network.chainId),
    rpcUrls: [workingRpcUrl ?? network.rpc[0]],
    explorerUrl: network.explorers[0].url,
    selectedRpcUrl: workingRpcUrl || '',
    platformId,
    nativeAssetId,
    nativeAssetSymbol: network.nativeCurrency.symbol,
    // Not needed for benzin
    hasRelayer: false,
    rpcNoStateOverride: false, // TODO
    reestimateOn: 0,
    areContractsDeployed: false, // TODO
    features: [],
    feeOptions: { is1559: false },
    flagged: false,
    hasSingleton: false,
    iconUrls: [],
    erc4337: { enabled: false, hasPaymaster: false },
    isSAEnabled: false,
    predefined: false
  }
}

/**
 * Maps the configuration of a Relayer network to the Ambire network format.
 * Needed, because the structures does NOT fully match, some values need to be
 * transformed or parsed (number to bigint). And finally, because there are
 * default values that need to be set for the so called "predefined" networks.
 */
export const mapRelayerNetworkConfigToAmbireNetwork = (
  chainId: bigint,
  relayerNetwork: RelayerNetwork
): Network => {
  const { name, explorerUrl, selectedRpcUrl, isOptimistic, disableEstimateGas, rpcUrls, icon } =
    relayerNetwork
  const {
    ambireId: id,
    coingeckoPlatformId: platformId,
    native: {
      symbol: nativeAssetSymbol,
      coingeckoId: nativeAssetId,
      wrapped: { address: wrappedAddr },
      oldNativeAssetSymbols
    },
    smartAccounts: { hasRelayer, allowForce4337, erc4337: incomingErc4337 },
    feeOptions: incomingFeeOptions
  } = relayerNetwork

  const feeOptions = {
    is1559: incomingFeeOptions.is1559,
    minBaseFeeEqualToLastBlock: !!incomingFeeOptions.minBaseFeeEqualToLastBlock,
    ...(typeof incomingFeeOptions.minBaseFee === 'number' && {
      minBaseFee: BigInt(incomingFeeOptions.minBaseFee)
    }),
    ...(typeof incomingFeeOptions.elasticityMultiplier === 'number' && {
      elasticityMultiplier: BigInt(incomingFeeOptions.elasticityMultiplier)
    }),
    ...(typeof incomingFeeOptions.baseFeeMaxChangeDenominator === 'number' && {
      baseFeeMaxChangeDenominator: BigInt(incomingFeeOptions.baseFeeMaxChangeDenominator)
    }),
    ...(typeof incomingFeeOptions.feeIncrease === 'number' && {
      feeIncrease: BigInt(incomingFeeOptions.feeIncrease)
    })
  }

  const erc4337: Erc4337settings = {
    enabled: incomingErc4337.enabled,
    hasPaymaster: incomingErc4337.hasPaymaster,
    ...(typeof incomingErc4337.hasBundlerSupport === 'boolean' && {
      hasBundlerSupport: incomingErc4337.hasBundlerSupport
    }),
    // TODO: Also store the values (bundler API keys) somewhere. Currently,
    // they are pulled from the .env file
    ...(incomingErc4337.bundlers && {
      bundlers: Object.keys(incomingErc4337.bundlers) as BUNDLER[]
    }),
    ...(incomingErc4337.defaultBundler && {
      defaultBundler: incomingErc4337.defaultBundler
    })
  }

  // TODO: Change the Relayer response?
  const iconUrls = [icon]

  // Always fallback to these values for the "predefined" networks, coming from
  // the RPC for the custom networks.
  // TODO: Shouldn't we include these values in the Relayer response?
  // TODO: Call the RPC to get these values dynamically?
  const rpcNoStateOverride = false
  const isSAEnabled = true
  const areContractsDeployed = true
  const features: NetworkFeature[] = []
  const hasSingleton = true

  // Coming from the RPC, only for the custom networks
  // const reestimateOn
  // const flagged
  // const blockGasLimit
  // const force4337

  return {
    predefined: true,
    name,
    iconUrls,
    explorerUrl,
    rpcUrls,
    selectedRpcUrl,
    isOptimistic,
    disableEstimateGas,
    id,
    platformId,
    chainId,
    nativeAssetSymbol,
    nativeAssetId,
    hasRelayer,
    wrappedAddr,
    oldNativeAssetSymbols,
    allowForce4337,
    feeOptions,
    erc4337,
    rpcNoStateOverride,
    isSAEnabled,
    areContractsDeployed,
    features,
    hasSingleton
  }
}

export { rollProviderUrlsAndFindWorking, checkIsRpcUrlWorking, convertToAmbireNetworkFormat }
