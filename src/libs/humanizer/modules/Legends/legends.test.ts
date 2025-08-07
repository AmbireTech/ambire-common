import { Interface, Wallet, ZeroAddress } from 'ethers'

import { describe, it } from '@jest/globals'

import { Legends } from '../../const/abis'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getImage, getLabel } from '../../utils'
import legendsModule from './index'

const iface = new Interface(Legends)
const INVITEE_V2_ACCOUNT = Wallet.createRandom().address
const INVITEE_EOA_OR_V1 = Wallet.createRandom().address
const INVITER_V2 = Wallet.createRandom().address
const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971'
const NFT_CONTRACT_ADDRESS = '0xF51dF52d0a9BEeB7b6E4B6451e729108a115B863'

describe('Legends', () => {
  it('Linking, both invitation and no invitation', () => {
    const acceptSpecificInvite = iface.encodeFunctionData('linkAndAcceptInvite', [
      INVITEE_V2_ACCOUNT,
      INVITEE_EOA_OR_V1,
      INVITER_V2,
      '0x'
    ])
    const acceptAnyInvitation = iface.encodeFunctionData('linkAndAcceptInvite', [
      INVITEE_V2_ACCOUNT,
      INVITEE_EOA_OR_V1,
      ZeroAddress,
      '0x'
    ])
    const irCalls: IrCall[] = [
      { data: acceptSpecificInvite, to: ONCHAIN_TXNS_LEGENDS_ADDRESS, value: 0n },
      { data: acceptAnyInvitation, to: ONCHAIN_TXNS_LEGENDS_ADDRESS, value: 0n }
    ]
    const expectedVisualizations: HumanizerVisualization[][] = [
      [
        getAction('Accept invitation'),
        getLabel('from'),
        getAddressVisualization(INVITER_V2),
        getLabel('and'),
        getAction('Link account'),
        getAddressVisualization(INVITEE_EOA_OR_V1),
        getLabel('to'),
        getAddressVisualization(INVITEE_V2_ACCOUNT)
      ],
      [
        getAction('Link account'),
        getAddressVisualization(INVITEE_EOA_OR_V1),
        getLabel('to'),
        getAddressVisualization(INVITEE_V2_ACCOUNT)
      ]
    ]
    const newCalls = legendsModule({} as any, irCalls, {} as any)
    compareHumanizerVisualizations(newCalls, expectedVisualizations)
  })
  it('Mint nft', () => {
    const irCalls = [
      {
        to: NFT_CONTRACT_ADDRESS,
        value: 0n,
        data: iface.encodeFunctionData('mint(uint)', [1])
      }
    ]
    const newCalls = legendsModule({} as any, irCalls, {} as any)
    const expectedVisualizations = [
      [
        getAction('Pick character'),
        getImage('https://relayer.ambire.com/legends/nft-image/avatar/slime-lvl0.png'),
        getLabel('for Ambire Rewards')
      ]
    ]
    compareHumanizerVisualizations(newCalls, expectedVisualizations)
  })
  it('invite', () => {
    const irCalls = [
      {
        to: ONCHAIN_TXNS_LEGENDS_ADDRESS,
        value: 0n,
        data: iface.encodeFunctionData('invite', [INVITEE_V2_ACCOUNT])
      }
    ]
    const newCalls = legendsModule({} as any, irCalls, {} as any)
    const expectedVisualizations = [
      [
        getAction('Invite'),
        getAddressVisualization(INVITEE_V2_ACCOUNT),
        getLabel('to Ambire Rewards')
      ]
    ]
    compareHumanizerVisualizations(newCalls, expectedVisualizations)
  })
})
