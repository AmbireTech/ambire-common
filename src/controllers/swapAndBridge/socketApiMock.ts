import { networks } from '../../consts/networks'
import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIToken,
  SwapAndBridgeRoute,
  SwapAndBridgeSendTxRequest
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
          fromChainId: 10,
          toChainId: 8453,
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
          inputValueInUsd: 0.01997,
          outputValueInUsd: 0.0202,
          toToken: {
            chainId: toChainId,
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            symbol: 'ETH',
            name: 'Ethereum',
            decimals: 18,
            icon: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            logoURI: 'https://assets.polygon.technology/tokenAssets/eth.svg',
            chainAgnosticId: 'ETH'
          },
          userTxs: [
            {
              chainId: fromChainId,
              toAmount: '8398236190482',
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
                  minAmountOut: '8319245375801'
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
                  serviceTime: 60,
                  maxServiceTime: 7200,
                  extraData: {
                    rewards: []
                  }
                }
              ],
              serviceTime: 60,
              recipient: userAddress,
              maxServiceTime: 7200,
              bridgeSlippage: 0.5,
              swapSlippage: 1,
              userTxIndex: 0
            },
            {
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

  async startRoute({ route }: { route: SwapAndBridgeRoute }): Promise<SwapAndBridgeSendTxRequest> {
    return {
      txData:
        '0x0000019aa1b4f14b00000000000000000000000000000000000000000000000000000000000001960000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000098000000000000000000000000000000000000000000000000000000000000008e4ee8f0b860000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000a0400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000808415565b00000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000003b8561954e000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000044000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000005e0000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000360000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000420000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000002e00000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000012556e69737761705633000000000000000000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000003b9c45870b1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000e592427a0aece92de3edee1f18e0157c0586156400000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b0b2c639c533813f4aa9d7837caf62653d097ff850001f442000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000004200000000000000000000000000000000000006ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000000016e3f1bd1000000000000000000000000ad01c20d5886137e056775af56915de824c8fce5000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000000869584cd00000000000000000000000010000000000000000000000000000000000000110000000000000000000000000000000000000000de7265c731f34e2d2fccf2dd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea000000000000000000000000813f71d642f533399527cbcdbfc77482893f0fea0000000000000000000000000000000000000000000000000000316bf7320e95000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000000000000000d000000000000000000000000000000000000000000000000000003bc961047b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000b8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000a0400000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      txTarget: '0x3a23F943181408EAC424116Af7b7790c94Cb97a5',
      chainId: route.fromChainId,
      userTxIndex: 0,
      activeRouteId: '4338463',
      value: '0x316bf7320e95',
      approvalData: null
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRouteStatus({ txHash }: { txHash: string }) {
    return 'completed'
  }
}
