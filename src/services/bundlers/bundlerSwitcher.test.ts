import { BICONOMY } from '../../consts/bundlers'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { noStateUpdateStatuses, SigningStatus } from '../../controllers/signAccountOp/signAccountOp'
import { Account } from '../../interfaces/account'
import { BundlerSwitcher } from './bundlerSwitcher'
import { DevBundlerSwitcher } from './DevBundlerSwitcher'

const base = networks.find((net) => net.id === 'base')!
const avalanche = networks.find((net) => net.id === 'avalanche')!

const smartAccDeployed: Account = {
  addr: '0x8E5F6c1F0b134657A546932C3eC9169E1633a39b',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  creation: {
    factoryAddr: AMBIRE_ACCOUNT_FACTORY,
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d731cde6a53e9a411eaaf9d11e3e8c653a3e379d5355af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb'],
  preferences: {
    label: 'test',
    pfp: '0x8E5F6c1F0b134657A546932C3eC9169E1633a39b'
  }
}

describe('bundler switcher: switch cases', () => {
  it('should switch when sign account op is in a ready to sign state and there are extra bundlers to switch to', async () => {
    const switcher = new BundlerSwitcher(
      base,
      () => {
        return SigningStatus.ReadyToSign
      },
      noStateUpdateStatuses
    )
    expect(switcher.userHasCommitted()).toBe(false)
    expect(switcher.canSwitch(smartAccDeployed, null)).toBe(true)
  })
})

describe('bundler switcher: no switch cases', () => {
  it('should not switch when sign account op is in a signing state', async () => {
    const switcher = new BundlerSwitcher(
      base,
      () => {
        return SigningStatus.InProgress
      },
      noStateUpdateStatuses
    )
    expect(switcher.userHasCommitted()).toBe(true)
    expect(switcher.canSwitch(smartAccDeployed, null)).toBe(false)
  })
  it('should not switch when there is no extra bundler to switch to', async () => {
    const switcher = new BundlerSwitcher(
      avalanche,
      () => {
        return SigningStatus.ReadyToSign
      },
      noStateUpdateStatuses
    )
    expect(switcher.userHasCommitted()).toBe(false)
    expect(switcher.canSwitch(smartAccDeployed, null)).toBe(false)
  })
  it('should not switch when there is no available bundler to switch to', async () => {
    const switcher = new DevBundlerSwitcher(
      base,
      () => {
        return SigningStatus.ReadyToSign
      },
      noStateUpdateStatuses,
      [BICONOMY]
    )
    expect(switcher.userHasCommitted()).toBe(false)
    expect(switcher.canSwitch(smartAccDeployed, null)).toBe(false)
  })
  it('should not switch on an estimation error even if there is a bundler available', async () => {
    const switcher = new DevBundlerSwitcher(
      base,
      () => {
        return SigningStatus.ReadyToSign
      },
      noStateUpdateStatuses,
      [BICONOMY]
    )
    expect(switcher.userHasCommitted()).toBe(false)
    expect(switcher.canSwitch(smartAccDeployed, new Error('reverted onchain'))).toBe(false)
  })
})
