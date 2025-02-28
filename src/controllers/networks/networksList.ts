export const networksList = {
    534352: {
        predefinedConfigVersion: 1,
        ambireId: 'scroll',
        platformId: 'scroll',
        name: 'Scroll',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_scroll.jpg'],
        explorerUrl: 'https://scrollscan.com',
        rpcUrls: ['https://invictus.ambire.com/scroll'],
        selectedRpcUrl: 'https://invictus.ambire.com/scroll',
        native: {
            symbol: 'ETH',
            name: 'Ether',
            coingeckoId: 'ethereum',
            icon: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
            decimals: 18,
            wrapped: {
                address: '0x5300000000000000000000000000000000000004',
                symbol: 'WETH',
                name: 'Wrapped Ether',
                coingeckoId: 'weth',
                icon: 'https://coin-images.coingecko.com/coins/images/2518/small/weth.png',
                decimals: 18,
            }
        },
        isOptimistic: false,
        disableEstimateGas: true,
        feeOptions: {
            is1559: false
        },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: false,
                hasPaymaster: true,
                hasBundlerSupport: true,
                bundlers: {
                    pimlico: `https://api.pimlico.io/v2/534352/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
                    biconomy: 'https://bundler.biconomy.io/api/v3/534352/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
                },
                defaultBundler: 'pimlico'
              },
            allowForce4337: true
        }
    },
    137: {
        predefinedConfigVersion: 1,
        ambireId: 'polygon',
        platformId: 'polygon-pos',
        name: 'Polygon',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_polygon.jpg'],
        explorerUrl: 'https://polygonscan.com',
        rpcUrls: ['https://invictus.ambire.com/polygon'],
        selectedRpcUrl: 'https://invictus.ambire.com/polygon',
        native: {
            symbol: 'POL',
            name: 'Polygon',
            coingeckoId: 'matic-network',
            icon: 'https://coin-images.coingecko.com/coins/images/4713/small/polygon.png',
            decimals: 18,
            wrapped: {
                address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
                symbol: 'WPOL',
                name: 'Wrapped POL',
                coingeckoId: 'wmatic',
                icon: 'https://coin-images.coingecko.com/coins/images/14073/small/matic.png',
                decimals: 18,
            },
            oldNativeAssetSymbols: ['MATIC']
        },
        isOptimistic: false,
        disableEstimateGas: true,
        feeOptions: {
            is1559: false,
            feeIncrease: 10 },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: false,
                hasPaymaster: true,
                hasBundlerSupport: true,
                bundlers: {
                    pimlico: `https://api.pimlico.io/v2/137/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
                    biconomy: 'https://bundler.biconomy.io/api/v3/137/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
                },
                defaultBundler: 'pimlico'
              },
            allowForce4337: true
        }
    },
    10: {
        predefinedConfigVersion: 1,
        ambireId: 'optimism',
        platformId: 'optimistic-ethereum',
        name: 'OP Mainnet',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_optimism.jpg'],
        explorerUrl: 'https://optimistic.etherscan.io',
        rpcUrls: ['https://invictus.ambire.com/optimism'],
        selectedRpcUrl: 'https://invictus.ambire.com/optimism',
        native: {
            symbol: 'ETH',
            name: 'Ether',
            coingeckoId: 'ethereum',
            icon: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
            decimals: 18,
            wrapped: {
                address: '0x4200000000000000000000000000000000000006',
                symbol: 'WETH',
                name: 'Wrapped Ether',
                coingeckoId: 'weth',
                icon: 'https://coin-images.coingecko.com/coins/images/2518/small/weth.png',
                decimals: 18,
            }
        },
        isOptimistic: true,
        disableEstimateGas: true,
        feeOptions: {
            is1559: true,
            elasticityMultiplier: 6,
            baseFeeMaxChangeDenominator: 50
        },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: true,
                hasPaymaster: true,
                hasBundlerSupport: true,
                bundlers: {
                    pimlico: `https://api.pimlico.io/v2/10/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
                    biconomy: 'https://bundler.biconomy.io/api/v3/10/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
                },
                defaultBundler: 'pimlico'
              },
            allowForce4337: true
        }
    },
    5000: {
        predefinedConfigVersion: 1,
        ambireId: 'mantle',
        platformId: 'mantle',
        name: 'Mantle',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_mantle.jpg'],
        explorerUrl: 'https://mantlescan.xyz/',
        rpcUrls: ['https://mantle-rpc.publicnode.com'],
        selectedRpcUrl: 'https://mantle-rpc.publicnode.com',
        native: {
            symbol: 'MNT',
            name: 'Mantle',
            coingeckoId: 'mantle',
            icon: 'https://coin-images.coingecko.com/coins/images/30980/small/token-logo.png',
            decimals: 18,
            wrapped: {
                address: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
                symbol: 'WMNT',
                name: 'Wrapped Mantle',
                coingeckoId: 'wrapped-mantle',
                icon: 'https://coin-images.coingecko.com/coins/images/30983/small/mantle.jpeg',
                decimals: 18,
            }
        },
        isOptimistic: true,
        disableEstimateGas: true,
        feeOptions: {
            is1559: true,
            minBaseFeeEqualToLastBlock: true
        },
        smartAccounts: {
            hasRelayer: false,
            erc4337: {
                enabled: true,
                hasPaymaster: true,
                hasBundlerSupport: true,
              },
            allowForce4337: true
        }
    },
    1: {
        predefinedConfigVersion: 1,
        ambireId: 'ethereum',
        platformId: 'ethereum',
        name: 'Ethereum',
        iconUrls: ['https://coin-images.coingecko.com/coins/images/279/small/ethereum.png'],
        explorerUrl: 'https://etherscan.io',
        rpcUrls: ['https://invictus.ambire.com/ethereum'],
        selectedRpcUrl: 'https://invictus.ambire.com/ethereum',
        native: {
            symbol: 'ETH',
            name: 'Ether',
            coingeckoId: 'ethereum',
            icon: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
            decimals: 18,
            wrapped: {
                address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                symbol: 'WETH',
                name: 'Wrapped Ether',
                coingeckoId: 'weth',
                icon: 'https://coin-images.coingecko.com/coins/images/2518/small/weth.png',
                decimals: 18,
            }
        },
        disableEstimateGas: true,
        feeOptions: { is1559: true },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: false,
                hasPaymaster: true,
                hasBundlerSupport: true
            },
            allowForce4337: true
        }
    },
    8453: {
        predefinedConfigVersion: 1,
        ambireId: 'base',
        platformId: 'base',
        name: 'Base',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_base.jpg'],
        explorerUrl: 'https://basescan.org',
        rpcUrls: ['https://invictus.ambire.com/base'],
        selectedRpcUrl: 'https://invictus.ambire.com/base',
        native: {
            symbol: 'ETH',
            name: 'Ether',
            coingeckoId: 'ethereum',
            icon: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
            decimals: 18,
            wrapped: {
                address: '0x4200000000000000000000000000000000000006',
                symbol: 'WETH',
                name: 'Wrapped Ether',
                coingeckoId: 'weth',
                icon: 'https://coin-images.coingecko.com/coins/images/2518/small/weth.png',
                decimals: 18,
            }
        },
        isOptimistic: true,
        disableEstimateGas: true,
        feeOptions: {
            is1559: true,
            minBaseFeeEqualToLastBlock: true
        },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: true,
                hasPaymaster: true,
                hasBundlerSupport: true,
                bundlers: {
                    pimlico: `https://api.pimlico.io/v2/8453/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
                    biconomy: 'https://bundler.biconomy.io/api/v3/8453/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
                },
                defaultBundler: 'pimlico'
              },
            allowForce4337: true
        }
    },
    43114: {
        predefinedConfigVersion: 1,
        ambireId: 'avalanche',
        platformId: 'avalanche',
        name: 'Avalanche',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg'],
        explorerUrl: 'https://snowtrace.io',
        rpcUrls: ['https://invictus.ambire.com/avalanche'],
        selectedRpcUrl: 'https://invictus.ambire.com/avalanche',
        native: {
            symbol: 'AVAX',
            name: 'Avalanche',
            coingeckoId: 'avalanche-2',
            icon: 'https://coin-images.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
            decimals: 18,
            wrapped: {
                address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                symbol: 'WAVAX',
                name: 'Wrapped Avalanche',
                coingeckoId: 'wrapped-avax',
                icon: 'https://coin-images.coingecko.com/coins/images/15075/small/wrapped-avax.png',
                decimals: 18,
            }
        },
        isOptimistic: false,
        disableEstimateGas: true,
        feeOptions: {
            is1559: true,
            minBaseFee: 25000000000 // 25 gwei
        },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: true,
                hasPaymaster: true,
                hasBundlerSupport: true
            },
            allowForce4337: true
        }
    },
    42161: {
        predefinedConfigVersion: 1,
        ambireId: 'arbitrum',
        platformId: 'arbitrum-one',
        name: 'Arbitrum',
        iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg'],
        explorerUrl: 'https://arbiscan.io',
        rpcUrls: ['https://invictus.ambire.com/arbitrum'],
        selectedRpcUrl: 'https://invictus.ambire.com/arbitrum',
        native: {
            symbol: 'ETH',
            name: 'Ether',
            coingeckoId: 'ethereum',
            icon: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
            decimals: 18,
            wrapped: {
                address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
                symbol: 'WETH',
                name: 'Wrapped Ether',
                coingeckoId: 'weth',
                icon: 'https://coin-images.coingecko.com/coins/images/2518/small/weth.png',
                decimals: 18,
            }
        },
        isOptimistic: false,
        disableEstimateGas: true,
        feeOptions: {
            is1559: true,
            minBaseFee: 100000000 // 1 gwei
        },
        smartAccounts: {
            hasRelayer: true,
            erc4337: {
                enabled: true,
                hasPaymaster: true,
                hasBundlerSupport: true,
                bundlers: {
                    pimlico: `https://api.pimlico.io/v2/42161/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
                    biconomy: 'https://bundler.biconomy.io/api/v3/42161/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
                },
                defaultBundler: 'pimlico'
              },
            allowForce4337: true
        }
    },
    // 100: {
    //     predefinedConfigVersion: 1,
    //     ambireId: 'gnosis',
    //     platformId: 'gnosis',
    //     name: 'Gnosis',
    //     iconUrls: ['https://icons.llamao.fi/icons/chains/rsz_gnosis.jpg'],
    //     explorerUrl: 'https://gnosisscan.io',
    //     rpcUrls: ['https://invictus.ambire.com/gnosis'],
    //     selectedRpcUrl: 'https://invictus.ambire.com/gnosis',
    //     native: {
    //         symbol: 'xDAI',
    //         name: 'xDAI',
    //         coingeckoId: 'xdai',
    //         icon: 'https://coin-images.coingecko.com/coins/images/11062/small/xdai.png',
    //         decimals: 18,
    //         wrapped: {
    //             address: '0x6A023cD1A9EFa696fC1E6aC2e7d5dE1dFfFfA9a3',
    //             symbol: 'WXDAI',
    //             name: 'Wrapped xDAI',
    //             coingeckoId: 'wrapped-xdai',
    //             icon: 'https://coin-images.coingecko.com/coins/images/11062/small/xdai.png',
    //             decimals: 18,
    //         }
    //     },
    //     isOptimistic: false,
    //     disableEstimateGas: true,
    //     feeOptions: {
    //         is1559: false
    //     },
    //     smartAccounts: {
    //         hasRelayer: true,
    //         erc4337: {
    //             enabled: false,
    //             hasPaymaster: true,
    //             hasBundlerSupport: true,
    //             bundlers: {
    //                 pimlico: `https://api.pimlico.io/v2/100/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
    //                 biconomy: 'https://bundler.biconomy.io/api/v3/100/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44'
    //             },
    //             defaultBundler: 'pimlico'
    //           },
    //         allowForce4337: true
    //     }
    // }
}