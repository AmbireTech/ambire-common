import { Interface, JsonRpcProvider, MaxUint256, solidityPackedKeccak256 } from 'ethers'

import { beforeAll, expect } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { AccountOp } from '../accountOp/accountOp'
import { ERC20, ERC721 } from '../humanizer/const/abis'
import { debugTraceCall } from './debugTraceCall'

const NFT_ADDRESS = '0xb7330c592dc5feafda855867b1e172be3a8d4abf'

describe('Debug tracecall detection for transactions', () => {
  const provider = new JsonRpcProvider('https://invictus.ambire.com/polygon')
  let account: Account
  let accountOp: AccountOp
  const nftIface: Interface = new Interface(ERC721)
  const tokenIface: Interface = new Interface(ERC20)
  let state: AccountOnchainState
  beforeAll(async () => {
    account = {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      initialPrivileges: [
        [
          '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
          '0x0000000000000000000000000000000000000000000000000000000000000002'
        ]
      ],
      associatedKeys: ['0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA'],
      creation: {
        factoryAddr: '0x26cE6745A633030A6faC5e64e41D21fb6246dc2d',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000027fa27fd83f65c3d89187ef0fd4fe62738d42ec134f8b2d8bf78612bd1cad581bb5553d602d80604d3d3981f3363d3d373d3d3d363d730f2aa7bcda3d9d210df69a394b6965cb2566c8285af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
      },
      preferences: { label: 'TEST SMART', pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8' },
      // usedOnNetworks: [],
      newlyCreated: false,
      newlyAdded: false
    }
    accountOp = {
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      networkId: 'polygon',
      signingKeyAddr: '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
      signingKeyType: 'internal',
      gasLimit: null,
      gasFeePayment: {
        paidBy: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        isERC4337: false,
        isGasTank: false,
        inToken: '0x0000000000000000000000000000000000000000',
        amount: 5205038755874012n,
        simulatedGasLimit: 139864n,
        gasPrice: 33831818155n
      },
      nonce: 1n,
      signature: '0x000000000000000000000000db26aeea3b986887feaba661df6d211e725797a003',
      accountOpToExecuteBefore: null,
      calls: [
        {
          to: '0xb7330c592dc5feafda855867b1e172be3a8d4abf',
          value: 0n,
          data: '0x23b872dd000000000000000000000000d034ddc997283b8179a12fe8d36a7356f01f2ddd00000000000000000000000073573bacb097a65786ebd7968e5775cbb89c73570000000000000000000000000000000000000000000000000000000000000003',
          fromUserRequestId: 1723530835106
        }
      ]
    }
    state = {
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      nonce: 1n,
      erc4337Nonce: 115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      isDeployed: true,
      associatedKeysPriviliges: {
        '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA':
          '0x0000000000000000000000000000000000000000000000000000000000000002'
      },
      isV2: true,
      balance: 989858878709479465n,
      isEOA: false,
      isErc4337Enabled: false,
      currentBlock: 60529438n,
      deployError: false,
      isErc4337Nonce: false
    }
  })

  it('Detects nfts and tokens in and out', async () => {
    accountOp.calls = [
      {
        to: NFT_ADDRESS,
        value: 0n,
        data: nftIface.encodeFunctionData(
          'transferFrom(address from, address to, uint256 tokenId)',
          [account.addr, '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337', 3n]
        )
      },
      {
        to: NFT_ADDRESS,
        value: 0n,
        data: nftIface.encodeFunctionData(
          'transferFrom(address from, address to, uint256 tokenId)',
          ['0xC2E6dFcc2C6722866aD65F211D5757e1D2879337', account.addr, 4n]
        )
      },
      // usdt transfer
      {
        to: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        value: 0n,
        data: tokenIface.encodeFunctionData('transfer', [
          '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
          1000000
        ])
      },
      // usdc pull
      {
        to: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        value: 0n,
        data: tokenIface.encodeFunctionData(
          'transferFrom(address from, address to, uint256 tokenId)',
          ['0xd034DDc997283B8179A12fE8d36a7356F01f2Ddd', account.addr, 1]
        )
      }
    ]

    const approvalStorageSlotUSDC = solidityPackedKeccak256(
      ['uint256', 'uint256'],
      [
        '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        solidityPackedKeccak256(
          ['uint256', 'uint256'],
          ['0xd034DDc997283B8179A12fE8d36a7356F01f2Ddd', 10]
        )
      ]
    )
    const overrideData = {
      '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359': {
        stateDiff: {
          [approvalStorageSlotUSDC]: `0x${MaxUint256.toString(16)}`
        }
      }
    }

    const res = await debugTraceCall(
      account,
      accountOp,
      provider,
      state,
      // a lot of gas
      100000000000000n,
      [{ name: 'fast', gasPrice: 338318181550000000n }],
      true,
      overrideData
    )

    expect(res.nfts.length).toBe(1)
    expect(res.nfts[0][0]).toBe('0xB7330C592dC5fEaFdA855867B1E172be3a8d4aBf')
    expect(res.nfts[0][1]).toContain(4n)
    expect(res.nfts[0][1]).toContain(3n)
    expect(res.tokens.length).toBe(2)
    expect(res.tokens).toContain('0xc2132D05D31c914a87C6611C10748AEb04B58e8F')
    expect(res.tokens).toContain('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')
  })
})
