import dotenv from 'dotenv'
import { getAddress, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Legends } from '../../const/abis/Legends'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getImage, getLabel } from '../../utils'

dotenv.config()

const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971'

const legendsModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(Legends)
  const characterTypes = [
    {
      type: 'Unknown',
      image: 'https://staging-relayer.ambire.com/legends/nft-image/avatar/unknown.png'
    },
    {
      type: 'Slime',
      image: 'https://staging-relayer.ambire.com/legends/nft-image/avatar/slime-lvl0.png'
    },
    {
      type: 'Sorceress',
      image: 'https://staging-relayer.ambire.com/legends/nft-image/avatar/sorceress-lvl0.png'
    },
    {
      type: 'Necromancer Vitalik',
      image: 'https://staging-relayer.ambire.com/legends/nft-image/avatar/necromancer-lvl0.png'
    },
    {
      type: 'Penguin Paladin',
      image: 'https://staging-relayer.ambire.com/legends/nft-image/avatar/penguin-lvl0.png'
    }
  ]
  const matcher = {
    [iface.getFunction('mint')?.selector!]: (call: IrCall) => {
      const [heroType] = iface.parseTransaction(call)!.args

      return [
        getAction('Pick character'),
        getImage(characterTypes[heroType].image),
        getLabel(characterTypes[heroType].type || 'Unknown', true),
        getLabel('for Ambire Legends')
      ]
    },
    [iface.getFunction('spinWheel')?.selector!]: () => {
      return [getAction('Spin the wheel of fortune')]
    },
    [iface.getFunction('linkAndAcceptInvite')?.selector!]: (call: IrCall) => {
      const [inviteeV2Account, inviteeEoaOrV1, inviter] = iface.parseTransaction(call)!.args
      const acceptInvitationVisualizationPrefix =
        inviter !== ZeroAddress
          ? [
              getAction('Accept invitation'),
              getLabel('from'),
              getAddressVisualization(inviter),
              getLabel('and')
            ]
          : []
      return [
        ...acceptInvitationVisualizationPrefix,
        getAction('Link account'),
        getAddressVisualization(inviteeEoaOrV1),
        getLabel('to'),
        getAddressVisualization(inviteeV2Account)
      ]
    },
    [iface.getFunction('invite')?.selector!]: (call: IrCall) => {
      const [invitee] = iface.parseTransaction(call)!.args

      return [getAction('Invite'), getAddressVisualization(invitee), getLabel('to Ambire Legends')]
    }
  }
  const newCalls = calls.map((call) => {
    if (
      ![ONCHAIN_TXNS_LEGENDS_ADDRESS, process.env.LEGENDS_NFT_ADDRESS].includes(
        getAddress(call.to)
      ) ||
      !matcher[call.data.slice(0, 10)]
    )
      return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default legendsModule
