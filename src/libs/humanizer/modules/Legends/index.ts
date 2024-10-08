import { getAddress, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971'
const NFT_CONTRACT_ADDRESS = '0x52d067EBB7b06F31AEB645Bd34f92c3Ac13a29ea'
// @TODO add test
const LegendsModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface([
    'function mint(uint256 )',
    'function spinWheel(uint256 random)',
    'function linkAndAcceptInvite(address INVITEE_V2_ACCOUNT, address INVITEE_EOA_OR_V1, address INVITER_V2, bytes signature)',
    'function invite(address)'
  ])
  const characterTypes = ['Unknown', 'Slime', 'Sorceress', 'Necromancer Vitalik', 'Penguin Paladin']
  const matcher = {
    [iface.getFunction('mint')?.selector!]: (call: IrCall) => {
      const [heroType] = iface.parseTransaction(call)!.args
      // @TODO add actual nft with image to display
      return [
        // @TODO text
        getAction('Pick character'),
        getLabel(characterTypes[heroType] || 'Uncreated'),
        getLabel('for Ambire Legends')
      ]
    },
    [iface.getFunction('spinWheel')?.selector!]: () => {
      return [
        // @TODO text
        getAction('Spin the wheel of fortune')
      ]
    },
    [iface.getFunction('linkAndAcceptInvite')?.selector!]: (call: IrCall) => {
      const [inviteeV2Account, inviteeEoaOrV1, inviter] = iface.parseTransaction(call)!.args
      // @TODO text
      const acceptInvitationVisualizationPrefix =
        inviter === ZeroAddress
          ? [
              getAction('Accept invitation'),
              getLabel('from'),
              getAddressVisualization(inviter),
              getLabel('and')
            ]
          : []
      return [
        ...acceptInvitationVisualizationPrefix,
        // @TODO text
        getAction('Link account'),
        getAddressVisualization(inviteeEoaOrV1),
        getLabel('to'),
        getAddressVisualization(inviteeV2Account)
      ]
    },
    [iface.getFunction('invite')?.selector!]: (call: IrCall) => {
      const [invitee] = iface.parseTransaction(call)!.args

      return [
        // @TODO text
        getAction('Invite'),
        getAddressVisualization(invitee),
        getLabel('to Ambire Legends')
      ]
    }
  }
  const newCalls = calls.map((call) => {
    if (
      ![ONCHAIN_TXNS_LEGENDS_ADDRESS, NFT_CONTRACT_ADDRESS].includes(getAddress(call.to)) ||
      !matcher[call.data.slice(0, 10)]
    )
      return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default LegendsModule
