import { networks } from '../../consts/networks'
import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPISendTransactionRequest,
  SocketAPIToken,
  SwapAndBridgeQuote
} from '../../interfaces/swapAndBridge'

/* eslint-disable class-methods-use-this */
export class SocketAPIMock {
  id = 'socket'

  #fetch: Fetch

  #baseUrl = 'https://api.socket.tech/v2'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch

    this.#headers = {
      'API-KEY': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  async getHealth() {
    return true
  }

  async updateHealth() {
    this.isHealthy = await this.getHealth()
  }

  resetHealth() {
    this.isHealthy = null
  }

  getSupportedChains() {
    return networks.map((network) => ({ chainId: network.chainId }))
  }

  async getToTokenList({
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SocketAPIToken[]> {
    return [
      {
        name: 'Coinbase Wrapped BTC',
        address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
        icon: 'https://tokens-data.1inch.io/images/8453/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.webp',
        decimals: 8,
        symbol: 'CBBTC',
        chainId: toChainId,
        logoURI:
          'https://tokens-data.1inch.io/images/8453/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.webp'
      },
      {
        name: 'Coinbase Wrapped Staked ETH',
        address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
        icon: 'https://media.socket.tech/tokens/all/CBETH',
        decimals: 18,
        symbol: 'CBETH',
        chainId: toChainId,
        logoURI: 'https://media.socket.tech/tokens/all/CBETH'
      },
      {
        name: 'USDT',
        address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        icon: 'https://media.socket.tech/tokens/all/USDT',
        decimals: 6,
        symbol: 'USDT',
        chainId: toChainId,
        logoURI: 'https://media.socket.tech/tokens/all/USDT'
      }
    ]
  }

  async quote({
    fromChainId,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress
  }: {
    fromChainId: number
    fromTokenAddress: string
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
  }) {
    return {
      routes: [
        {
          routeId: '16bb1d94-d028-4b64-b660-c0f50784ea3f',
          isOnlySwapRoute: false,
          fromAmount,
          toAmount: '33',
          usedBridgeNames: ['stargate'],
          minimumGasBalances: {
            '10': '1800000000000000',
            '8453': '1800000000000000'
          },
          chainGasBalances: {
            '10': {
              minGasBalance: '1800000000000000',
              hasGasBalance: false
            },
            '8453': {
              minGasBalance: '1800000000000000',
              hasGasBalance: false
            }
          },
          sender: userAddress,
          recipient: userAddress,
          totalGasFeesInUsd: 0.17037701010588965,
          receivedValueInUsd: -0.15017701010588966,
          inputValueInUsd: 0.01997,
          outputValueInUsd: 0.0202,
          userTxs: [
            {
              userTxType: 'fund-movr',
              txType: 'eth_sendTransaction',
              chainId: fromChainId,
              toAmount: '8398236190482',
              toAsset: {
                chainId: toChainId,
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                chainAgnosticId: 'ETH'
              },
              stepCount: 2,
              routePath: '406-410',
              sender: userAddress,
              approvalData: {
                minimumApprovalAmount: fromAmount,
                approvalTokenAddress: fromTokenAddress,
                allowanceTarget: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
                owner: userAddress
              },
              steps: [
                {
                  type: 'middleware',
                  protocol: {
                    name: 'zerox',
                    displayName: '0x',
                    icon: 'https://media.socket.tech/dexes/0x.svg'
                  },
                  chainId: fromChainId,
                  fromAsset: {
                    chainId: fromChainId,
                    address: fromTokenAddress,
                    symbol: 'USDC',
                    name: 'USD Coin',
                    decimals: 6,
                    icon: 'https://assets.polygon.technology/tokenAssets/usdc.svg',
                    logoURI: 'https://assets.polygon.technology/tokenAssets/usdc.svg',
                    chainAgnosticId: null
                  },
                  fromAmount,
                  toAsset: {
                    chainId: fromChainId,
                    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                    symbol: 'ETH',
                    name: 'Ethereum',
                    decimals: 18,
                    icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    chainAgnosticId: null
                  },
                  toAmount: '8403278157375',
                  swapSlippage: 1,
                  minAmountOut: '8319245375801',
                  gasFees: {
                    gasAmount: '2297984720000',
                    gasLimit: 283352,
                    asset: {
                      chainId: fromChainId,
                      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                      symbol: 'ETH',
                      name: 'Ethereum',
                      decimals: 18,
                      icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      chainAgnosticId: null
                    },
                    feesInUsd: 0.0054468902019687996
                  }
                },
                {
                  type: 'bridge',
                  protocol: {
                    name: 'stargate',
                    displayName: 'Stargate',
                    icon: 'https://s2.coinmarketcap.com/static/img/coins/128x128/18934.png',
                    securityScore: 2,
                    robustnessScore: 3
                  },
                  bridgeSlippage: 0.5,
                  fromChainId,
                  fromAsset: {
                    chainId: fromChainId,
                    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                    symbol: 'ETH',
                    name: 'Ethereum',
                    decimals: 18,
                    icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    chainAgnosticId: null
                  },
                  fromAmount: '8403278157375',
                  toChainId,
                  toAsset: {
                    chainId: toChainId,
                    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                    symbol: 'ETH',
                    name: 'Ethereum',
                    decimals: 18,
                    icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                    chainAgnosticId: 'ETH'
                  },
                  minAmountOut: '8272212227955',
                  toAmount: '8398236190482',
                  protocolFees: {
                    asset: {
                      chainId: fromChainId,
                      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                      symbol: 'ETH',
                      name: 'Ethereum',
                      decimals: 18,
                      icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      chainAgnosticId: null
                    },
                    feesInUsd: 0.000011950923706808,
                    amount: '5041966893'
                  },
                  gasFees: {
                    gasAmount: '64850800171325',
                    asset: {
                      chainId: fromChainId,
                      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                      symbol: 'ETH',
                      name: 'Ethereum',
                      decimals: 18,
                      icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                      chainAgnosticId: null
                    },
                    gasLimit: 1000000,
                    feesInUsd: 0.15371520313808992
                  },
                  serviceTime: 60,
                  maxServiceTime: 7200,
                  extraData: {
                    rewards: []
                  }
                }
              ],
              gasFees: {
                gasAmount: '67148784891325',
                feesInUsd: 0.15916209334005874,
                asset: {
                  chainId: fromChainId,
                  address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  symbol: 'ETH',
                  name: 'Ethereum',
                  decimals: 18,
                  icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  chainAgnosticId: null
                },
                gasLimit: 1283352
              },
              serviceTime: 60,
              recipient: userAddress,
              maxServiceTime: 7200,
              bridgeSlippage: 0.5,
              swapSlippage: 1,
              userTxIndex: 0
            },
            {
              userTxType: 'dex-swap',
              txType: 'eth_sendTransaction',
              swapSlippage: 1,
              chainId: toChainId,
              protocol: {
                name: 'zerox',
                displayName: '0x',
                icon: 'https://media.socket.tech/dexes/0x.svg'
              },
              fromAsset: {
                chainId: toChainId,
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                chainAgnosticId: 'ETH'
              },
              approvalData: null,
              fromAmount: '8398236190482',
              toAsset: {
                chainId: toChainId,
                address: toTokenAddress,
                symbol: 'cbBTC',
                name: 'Coinbase Wrapped BTC',
                decimals: 8,
                icon: null,
                logoURI: null,
                chainAgnosticId: null
              },
              toAmount: '33',
              minAmountOut: '32',
              gasFees: {
                gasAmount: '4731453436428',
                gasLimit: 441774,
                asset: {
                  chainId: toChainId,
                  address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  symbol: 'ETH',
                  name: 'Ethereum',
                  decimals: 18,
                  icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  chainAgnosticId: 'ETH'
                },
                feesInUsd: 0.011214916765830925
              },
              sender: userAddress,
              recipient: userAddress,
              userTxIndex: 1
            }
          ],
          serviceTime: 60,
          maxServiceTime: 7200,
          integratorFee: {
            amount: '0',
            asset: {
              chainId: fromChainId,
              address: fromTokenAddress,
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              icon: 'https://media.socket.tech/tokens/all/USDC',
              logoURI: 'https://media.socket.tech/tokens/all/USDC',
              chainAgnosticId: null
            }
          },
          extraData: {
            rewards: []
          }
        }
      ],
      socketRoute: null,
      destinationCallData: {},
      fromChainId,
      fromAsset: {
        chainId: fromChainId,
        address: fromTokenAddress,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        icon: 'https://media.socket.tech/tokens/all/USDC',
        logoURI: 'https://media.socket.tech/tokens/all/USDC',
        chainAgnosticId: null
      },
      toChainId,
      toAsset: {
        chainId: toChainId,
        address: toTokenAddress,
        symbol: 'CBBTC',
        name: 'Coinbase Wrapped BTC',
        decimals: 8,
        icon: 'https://tokens-data.1inch.io/images/8453toTokenAddresswebp',
        logoURI: 'https://tokens-data.1inch.io/images/8453toTokenAddresswebp',
        chainAgnosticId: null
      },
      bridgeRouteErrors: {
        cctp: {
          status: 'MIN_AMOUNT_NOT_MET'
        },
        'stargate-v2': {
          status: 'SOCKET_INTERNAL_SERVER_ERROR'
        },
        across: {
          status: 'MIN_AMOUNT_NOT_MET'
        },
        symbiosis: {
          status: 'INSUFFICIENT_INPUT_AMOUNT'
        },
        'refuel-bridge': {
          status: 'MIN_AMOUNT_NOT_MET'
        },
        hop: {
          status: 'INSUFFICIENT_INPUT_AMOUNT'
        },
        synapse: {
          status: 'ROUTE_NOT_FOUND'
        },
        'polygon-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        hyphen: {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'arbitrum-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'anyswap-router-v4': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'anyswap-router-v6': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        hopCctp: {
          status: 'ASSET_NOT_SUPPORTED'
        },
        celer: {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'optimism-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        connext: {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'base-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'zora-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'zksync-native': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'gnosis-native-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'mantle-native-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'scroll-native-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'mode-native-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        },
        'super-bridge': {
          status: 'ASSET_NOT_SUPPORTED'
        }
      }
    }
  }

  async startRoute({
    fromChainId,
    fromAssetAddress
  }: {
    fromChainId: number
    toChainId: number
    fromAssetAddress: string
    toAssetAddress: string
    route: SwapAndBridgeQuote['selectedRoute']
  }) {
    return {
      userTxType: 'fund-movr',
      txType: 'eth_sendTransaction',
      txData:
        '0x0000019aa1b4f14b00000000000000000000000000000000000000000000000000000000000001960000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000098000000000000000000000000000000000000000000000000000000000000008e4ee8f0b860000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000a0400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000808415565b00000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000003b8561954e000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000044000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000005e0000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000360000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000420000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000002e00000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000012556e69737761705633000000000000000000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000003b9c45870b1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000e592427a0aece92de3edee1f18e0157c0586156400000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b0b2c639c533813f4aa9d7837caf62653d097ff850001f442000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000004200000000000000000000000000000000000006ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000000016e3f1bd1000000000000000000000000ad01c20d5886137e056775af56915de824c8fce5000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000000869584cd00000000000000000000000010000000000000000000000000000000000000110000000000000000000000000000000000000000de7265c731f34e2d2fccf2dd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea0000000000000000000000000000000000000000000000000000316bf7320e95000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000003bc961047b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000b8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000a0400000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      txTarget: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
      chainId: fromChainId,
      userTxIndex: 0,
      activeRouteId: '4338463',
      value: '0x316bf7320e95',
      approvalData: {
        minimumApprovalAmount: '10000',
        approvalTokenAddress: fromAssetAddress,
        allowanceTarget: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
        owner: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRouteStatus(props: {
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
    userTxIndex: SocketAPISendTransactionRequest['userTxIndex']
    txHash: string
  }) {
    return props.userTxIndex === 1 ? 'completed' : 'ready'
  }

  async updateActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    return {
      activeRouteId,
      userAddress: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      userTxs: [
        {
          steps: [
            {
              type: 'middleware',
              chainId: 10,
              gasFees: {
                asset: {
                  icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  name: 'Ethereum',
                  symbol: 'ETH',
                  address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  chainId: 10,
                  logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  decimals: 18,
                  chainAgnosticId: null
                },
                gasLimit: 285352,
                feesInUsd: 0.0007534051663168406,
                gasAmount: '312852513648'
              },
              toAsset: {
                icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                name: 'Ethereum',
                symbol: 'ETH',
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                chainId: 10,
                logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                decimals: 18,
                chainAgnosticId: null
              },
              protocol: {
                icon: 'https://media.socket.tech/dexes/0x.svg',
                name: 'zerox',
                displayName: '0x'
              },
              toAmount: '4135625926302',
              fromAsset: {
                icon: 'https://assets.polygon.technology/tokenAssets/usdc.svg',
                name: 'USD Coin',
                symbol: 'USDC',
                address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
                chainId: 10,
                logoURI: 'https://assets.polygon.technology/tokenAssets/usdc.svg',
                decimals: 6,
                chainAgnosticId: null
              },
              fromAmount: '10000',
              minAmountOut: '4094269667038',
              swapSlippage: 1
            },
            {
              type: 'bridge',
              gasFees: {
                asset: {
                  icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  name: 'Ethereum',
                  symbol: 'ETH',
                  address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  chainId: 10,
                  logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  decimals: 18,
                  chainAgnosticId: null
                },
                gasLimit: 1000000,
                feesInUsd: 0.13350023376256365,
                gasAmount: '55436152514581'
              },
              toAsset: {
                icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                name: 'Ethereum',
                symbol: 'ETH',
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                chainId: 8453,
                logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                decimals: 18,
                chainAgnosticId: 'ETH'
              },
              protocol: {
                icon: 'https://s2.coinmarketcap.com/static/img/coins/128x128/18934.png',
                name: 'stargate',
                displayName: 'Stargate',
                securityScore: 2,
                robustnessScore: 3
              },
              toAmount: '4133144550747',
              extraData: {
                rewards: []
              },
              fromAsset: {
                icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                name: 'Ethereum',
                symbol: 'ETH',
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                chainId: 10,
                logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                decimals: 18,
                chainAgnosticId: null
              },
              toChainId: 8453,
              fromAmount: '4135625926302',
              fromChainId: 10,
              serviceTime: 60,
              minAmountOut: '4071122568729',
              protocolFees: {
                asset: {
                  icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  name: 'Ethereum',
                  symbol: 'ETH',
                  address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                  chainId: 10,
                  logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
                  decimals: 18,
                  chainAgnosticId: null
                },
                amount: '2481375555',
                feesInUsd: 0.000005975598984039
              },
              bridgeSlippage: 0.5,
              maxServiceTime: 7200
            }
          ],
          sender: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
          txType: 'eth_sendTransaction',
          chainId: 10,
          gasFees: {
            asset: {
              icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
              name: 'Ethereum',
              symbol: 'ETH',
              address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              chainId: 10,
              logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
              decimals: 18,
              chainAgnosticId: null
            },
            gasLimit: 1285352,
            feesInUsd: 0.13425363892888048,
            gasAmount: '55749005028229'
          },
          toAsset: {
            icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            name: 'Ethereum',
            symbol: 'ETH',
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            chainId: 8453,
            logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            decimals: 18,
            chainAgnosticId: 'ETH'
          },
          toAmount: '4133144550747',
          recipient: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
          routePath: '406-410',
          stepCount: 2,
          userTxType: 'fund-movr',
          serviceTime: 60,
          userTxIndex: 0,
          approvalData: {
            owner: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
            allowanceTarget: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
            approvalTokenAddress: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
            minimumApprovalAmount: '10000'
          },
          swapSlippage: 1,
          userTxStatus: 'completed',
          bridgeSlippage: 0.5,
          maxServiceTime: 7200,
          destinationTxHash: '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
          destinationTxReceipt: {
            to: '0xcb566e3B6934Fa77258d68ea18E931fa75e1aaAa',
            from: '0xe93685f3bBA03016F02bD1828BaDD6195988D950',
            logs: [
              {
                data: '0x000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f1beca945694a1da1dac5e3021928e2dd6623c4dfe3c3a0cf47fd288f26519c84a0950000000000000000000000000000000000000000000000000000000000000014701a95707a0290ac8b90b3719e8ee5b210360883000000000000000000000000',
                topics: [
                  '0x2bd2d8a84b748439fd50d79a49502b4eb5faa25b864da6a9ab5c150704be9a4d',
                  '0x000000000000000000000000000000000000000000000000000000000000006f',
                  '0x000000000000000000000000af54be5b6eec24d6bfacf1cce4eaf680a8239398'
                ],
                address: '0x38dE71124f7a447a01D67945a51eDcE9FF491251',
                logIndex: 19,
                blockHash: '0x66316830837d3664fd42d73f14de7c8cedadc641b9e7f017b64012fab8a70281',
                blockNumber: 20922920,
                transactionHash:
                  '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
                transactionIndex: 37
              },
              {
                data: '0x000000000000000000000000000000000000000000000000000000000000006f000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001d4dafaa7b9b7731ec',
                topics: ['0xdbdd25248751feb2f3b66721dfdd11662a68bc155af3771e661aabec92fba814'],
                address: '0x28fc411f9e1c480AD312b3d9C60c22b965015c6B',
                logIndex: 20,
                blockHash: '0x66316830837d3664fd42d73f14de7c8cedadc641b9e7f017b64012fab8a70281',
                blockNumber: 20922920,
                transactionHash:
                  '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
                transactionIndex: 37
              },
              {
                data: '0x000000000000000000000000000000000000000000000000000003c5b59aac9a',
                topics: [
                  '0xb4a87134099d10c48345145381989042ab07dc53e6e62a6511fca55438562e26',
                  '0x00000000000000000000000028fc411f9e1c480ad312b3d9c60c22b965015c6b',
                  '0x000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea'
                ],
                address: '0x224D8Fd7aB6AD4c6eb4611Ce56EF35Dec2277F03',
                logIndex: 21,
                blockHash: '0x66316830837d3664fd42d73f14de7c8cedadc641b9e7f017b64012fab8a70281',
                blockNumber: 20922920,
                transactionHash:
                  '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
                transactionIndex: 37
              },
              {
                data: '0x000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea000000000000000000000000000000000000000000000000000003c5b59aac9a000000000000000000000000000000000000000000000000000000008d003bf600000000000000000000000000000000000000000000000000000000076bcd42',
                topics: ['0xfb2b592367452f1c437675bed47f5e1e6c25188c17d7ba01a12eb030bc41ccef'],
                address: '0x28fc411f9e1c480AD312b3d9C60c22b965015c6B',
                logIndex: 22,
                blockHash: '0x66316830837d3664fd42d73f14de7c8cedadc641b9e7f017b64012fab8a70281',
                blockNumber: 20922920,
                transactionHash:
                  '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
                transactionIndex: 37
              }
            ],
            type: 0,
            status: 1,
            gasUsed: {
              hex: '0x0315e0',
              type: 'BigNumber'
            },
            blockHash: '0x66316830837d3664fd42d73f14de7c8cedadc641b9e7f017b64012fab8a70281',
            byzantium: true,
            logsBloom:
              '0x00000400000000000080200000000000000002000000000000000000000000000000000000000001000000000000000000020000000000000000400000000000000000000800000000000004000000000080000000000000000000000000000000000000000002000000100000000000000000000000000002000100000000000002008000000001000000004000000100000000000000000000000000000000000008002000000060000000000000000000004100082004000000000000000000040000000000000000000000000000000000000000000000000000008000000000000000000000200000000000000000020000001000000000000000000000',
            blockNumber: 20922920,
            confirmations: 6,
            contractAddress: null,
            transactionHash: '0xf459d462cc533a73bfa7ef9fcf22e7b8e3f4862115fbbdefb0207bc485fbac29',
            transactionIndex: 37,
            cumulativeGasUsed: {
              hex: '0x2c93f9',
              type: 'BigNumber'
            },
            effectiveGasPrice: {
              hex: '0x4592f8',
              type: 'BigNumber'
            }
          },
          sourceTransactionHash:
            '0x2ea8d137eab4a5226a4b0cce0cdcb3639171bc273f2e1c73df775ab1739c6e06',
          sourceTransactionReceipt: {
            to: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
            from: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
            logs: [],
            type: 2,
            status: 1,
            gasUsed: {
              hex: '0x0aefd7',
              type: 'BigNumber'
            },
            blockHash: '0xd2b0a9277ea51b57cbe99156a537ef552def028e8bed00b1301bc11c08e69a57',
            byzantium: true,
            logsBloom:
              '0x0000204202040000000000100000000000004008000800042c04000000080000000100100020000000040010001800082000000000012000040001000020000000400000000000080000000800802000000100000040400000000400800000000004000000000001000010100000000000009002000044000000009a000920000000008040000000000000000000000000000401282000020000009002000020820000000000432000000004800001000020001000200104000000800010000080029002000008000000008000008000000000440000000000000006002000001010800002000000000000000000100480020000000200400000400008003000',
            blockNumber: 126518175,
            confirmations: 4,
            contractAddress: null,
            transactionHash: '0x2ea8d137eab4a5226a4b0cce0cdcb3639171bc273f2e1c73df775ab1739c6e06',
            transactionIndex: 8,
            cumulativeGasUsed: {
              hex: '0x202cde',
              type: 'BigNumber'
            },
            effectiveGasPrice: {
              hex: '0x0363c5',
              type: 'BigNumber'
            }
          }
        },
        {
          sender: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
          txType: 'eth_sendTransaction',
          chainId: 8453,
          gasFees: {
            asset: {
              icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
              name: 'Ethereum',
              symbol: 'ETH',
              address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              chainId: 8453,
              logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
              decimals: 18,
              chainAgnosticId: 'ETH'
            },
            gasLimit: 566000,
            feesInUsd: 0.00522177973754892,
            gasAmount: '2168351094000'
          },
          toAsset: {
            icon: null,
            name: 'Coinbase Wrapped BTC',
            symbol: 'cbBTC',
            address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
            chainId: 8453,
            logoURI: null,
            decimals: 8,
            chainAgnosticId: null
          },
          protocol: {
            icon: 'https://media.socket.tech/dexes/0x.svg',
            name: 'zerox',
            displayName: '0x'
          },
          toAmount: '16',
          fromAsset: {
            icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            name: 'Ethereum',
            symbol: 'ETH',
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            chainId: 8453,
            logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            decimals: 18,
            chainAgnosticId: 'ETH'
          },
          recipient: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
          fromAmount: '4133144550747',
          userTxType: 'dex-swap',
          userTxIndex: 1,
          approvalData: null,
          minAmountOut: '15',
          swapSlippage: 1
        }
      ],
      fromChainId: 10,
      toChainId: 8453,
      fromAssetAddress: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
      toAssetAddress: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      fromAmount: '10000',
      toAmount: '16',
      refuel: null,
      routeStatus: 'PENDING',
      transactionData: {
        '0': {
          txHash: '0x2ea8d137eab4a5226a4b0cce0cdcb3639171bc273f2e1c73df775ab1739c6e06',
          chainId: 10
        }
      },
      bridgeTxHash: '0x2ea8d137eab4a5226a4b0cce0cdcb3639171bc273f2e1c73df775ab1739c6e06',
      recipient: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      integratorId: 2564,
      destinationCallData: null,
      bridgeInsuranceData: null,
      integratorFee: {
        asset: {
          icon: 'https://media.socket.tech/tokens/all/USDC',
          name: 'USD Coin',
          symbol: 'USDC',
          address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
          chainId: 10,
          logoURI: 'https://media.socket.tech/tokens/all/USDC',
          decimals: 6,
          chainAgnosticId: null
        },
        amount: '0'
      },
      createdAt: '2024-10-11T08:25:15.853Z',
      updatedAt: '2024-10-11T08:26:38.194Z',
      currentUserTxIndex: 1,
      fromAsset: {
        chainId: 10,
        address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        icon: 'https://media.socket.tech/tokens/all/USDC',
        logoURI: 'https://media.socket.tech/tokens/all/USDC',
        chainAgnosticId: null
      },
      toAsset: {
        chainId: 8453,
        address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
        symbol: 'CBBTC',
        name: 'Coinbase Wrapped BTC',
        decimals: 8,
        icon: 'https://tokens-data.1inch.io/images/8453/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.webp',
        logoURI:
          'https://tokens-data.1inch.io/images/8453/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.webp',
        chainAgnosticId: null
      }
    }
  }

  getActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    return this.updateActiveRoute(activeRouteId)
  }

  async getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    return {
      userTxType: 'dex-swap',
      txType: 'eth_sendTransaction',
      txData:
        '0x000001947899f9ed000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000000000000000000000000000000003c5b59aac9a000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea0000000000000000000000000000000000000000000000000000000000000a0400000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000b28415565b0000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf000000000000000000000000000000000000000000000000000003c5b59aac9a000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000008c0000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000040000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000003c5b59aac9a000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000360000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004200000000000000000000000000000000000006000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000003c5b59aac9a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000002556e6973776170563200000000000000000000000000000000000000000000000000000000000000000003c5b59aac9a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000004752ba5dbc23f44d87826276bf6fd6b1c372ad2400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000003000000000000000000000000420000000000000000000000000000000000000600000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf0000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000300ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000244165726f64726f6d6500000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000f000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000cf77a3ba9a5ca399b7c97c74d54e5b1beb874e4300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000cbb7c0000ab88b473b1f5afd9ef808440eed33bf0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000420dd381b31aef6683db6b902084cb0ffece40da0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000030000000000000000000000004200000000000000000000000000000000000006000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000869584cd000000000000000000000000100000000000000000000000000000000000001100000000000000000000000000000000000000005252a17c44e837f8ca3be173000000000000000000000000000000000000000000000000',
      txTarget: '0x3a23f943181408eac424116af7b7790c94cb97a5',
      chainId: 8453,
      activeRouteId,
      value: '0x03c5b59aac9a',
      userTxIndex: 1,
      approvalData: null
    }
  }
}
