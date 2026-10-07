import { getAddress, keccak256, toBeHex, toUtf8Bytes, zeroPadValue } from 'ethers'

import { AccountOp } from '../accountOp/accountOp'
import { getEthSimulateV1Params, parseEthSimulateV1Result } from './ethSimulatev1'

describe('parseEthSimulateV1Result', () => {
  const callTo = '0x1111111111111111111111111111111111111111'
  const tokenAddress = '0x2222222222222222222222222222222222222222'
  const nftAddress = '0x3333333333333333333333333333333333333333'
  const erc721TransferTopic = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'))
  const emptyTopic = zeroPadValue('0x', 32)

  it('discovers the simulated call target, log emitters and ERC-721 token IDs', () => {
    const result = parseEthSimulateV1Result(
      [
        {
          calls: [
            {
              logs: [
                {
                  address: tokenAddress,
                  topics: [erc721TransferTopic, emptyTopic, emptyTopic]
                },
                {
                  address: nftAddress,
                  topics: [
                    erc721TransferTopic,
                    emptyTopic,
                    emptyTopic,
                    zeroPadValue(toBeHex(25), 32)
                  ]
                }
              ]
            }
          ]
        }
      ],
      callTo
    )

    expect(result.tokens).toEqual([
      getAddress(callTo),
      getAddress(tokenAddress),
      getAddress(nftAddress)
    ])
    expect(result.nfts).toEqual([[getAddress(nftAddress), [25n]]])
  })

  it('discovers an ERC-20 from a payable token call target without logs', () => {
    const call = {
      to: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
      value: '0.00001',
      data: '0xd0e30db0756e697800000000000c'
    }

    const result = parseEthSimulateV1Result([{ calls: [{ logs: [] }] }], call.to)

    expect(result.tokens.map((address) => address.toLowerCase())).toContain(
      '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    )
    expect(result.nfts).toEqual([])
  })

  it('simulates basic EOA bundles as native sequential calls and discovers NVDA from logs', () => {
    const eoa = '0xB0A9723c87E1B4652D8cb9DDc4dd26e58126C125'
    const token = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    const swapper = '0xB477751B76CF82d00a686A1232f5fCD772414Af3'
    const nvda = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    const op = {
      accountAddr: eoa,
      calls: [
        {
          to: token,
          value: 0n,
          data: '0x095ea7b3'
        },
        {
          to: swapper,
          value: 0n,
          data: '0x4666fc80'
        }
      ]
    } as AccountOp

    const ethSimulateV1Params = getEthSimulateV1Params(op)
    if (!ethSimulateV1Params) throw new Error('Missing ethSimulateV1 params')
    const [payload] = ethSimulateV1Params.params
    const blockStateCall = payload.blockStateCalls[0]!

    expect(ethSimulateV1Params.callTargets).toEqual([token, swapper])
    expect(blockStateCall.calls).toEqual([
      {
        to: token,
        value: '0x0',
        data: '0x095ea7b3',
        from: eoa
      },
      {
        to: swapper,
        value: '0x0',
        data: '0x4666fc80',
        from: eoa
      }
    ])
    expect(blockStateCall.stateOverrides).toEqual({
      [eoa]: {
        balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      }
    })

    const result = parseEthSimulateV1Result(
      [
        {
          calls: [
            {
              logs: []
            },
            {
              logs: [
                {
                  address: nvda,
                  topics: [erc721TransferTopic, emptyTopic, emptyTopic]
                }
              ]
            }
          ]
        }
      ],
      ethSimulateV1Params.callTargets
    )

    expect(result.tokens.map((address) => address.toLowerCase())).toEqual([
      token.toLowerCase(),
      swapper.toLowerCase(),
      nvda
    ])
  })

  it('simulates Safe bundles as native sequential calls from the Safe address', () => {
    const safe = '0xeae134A0FC0181624f9Db1389247BddAEDc59682'
    const token = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    const swapper = '0xB477751B76CF82d00a686A1232f5fCD772414Af3'
    const rdw = '0x92ef19e82bd8ff36661de838d5eae7e5cef0effe'
    const op = {
      accountAddr: safe,
      calls: [
        {
          to: token,
          value: 0n,
          data: '0x095ea7b3'
        },
        {
          to: swapper,
          value: 0n,
          data: '0x4666fc80'
        }
      ]
    } as AccountOp

    const ethSimulateV1Params = getEthSimulateV1Params(op)
    if (!ethSimulateV1Params) throw new Error('Missing ethSimulateV1 params')
    const [payload] = ethSimulateV1Params.params
    const blockStateCall = payload.blockStateCalls[0]!

    expect(ethSimulateV1Params.callTargets).toEqual([token, swapper])
    expect(blockStateCall.calls).toEqual([
      {
        to: token,
        value: '0x0',
        data: '0x095ea7b3',
        from: safe
      },
      {
        to: swapper,
        value: '0x0',
        data: '0x4666fc80',
        from: safe
      }
    ])
    expect(blockStateCall.stateOverrides).toEqual({
      [safe]: {
        balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      }
    })

    const result = parseEthSimulateV1Result(
      [
        {
          calls: [
            {
              logs: []
            },
            {
              logs: [
                {
                  address: rdw,
                  topics: [erc721TransferTopic, emptyTopic, emptyTopic]
                }
              ]
            }
          ]
        }
      ],
      ethSimulateV1Params.callTargets
    )

    expect(result.tokens.map((address) => address.toLowerCase())).toContain(rdw)
  })

  it('gets the params for a single call to a Safe account successfully', () => {
    const safe = '0xeae134A0FC0181624f9Db1389247BddAEDc59682'
    const token = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    const op = {
      accountAddr: safe,
      calls: [
        {
          to: token,
          value: 0n,
          data: '0x095ea7b3'
        }
      ]
    } as AccountOp

    const ethSimulateV1Params = getEthSimulateV1Params(op)
    if (!ethSimulateV1Params) throw new Error('Missing ethSimulateV1 params')
    expect(ethSimulateV1Params.callTargets).toEqual([token])
  })
})
