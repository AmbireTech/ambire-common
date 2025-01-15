import { BICONOMY } from '../../consts/bundlers'
import { networks } from '../../consts/networks'
import { noStateUpdateStatuses, SigningStatus } from '../../controllers/signAccountOp/signAccountOp'
import { BundlerSwitcher } from './bundlerSwitcher'
import { DevBundlerSwitcher } from './DevBundlerSwitcher'

const base = networks.find((net) => net.id === 'base')!
const avalanche = networks.find((net) => net.id === 'avalanche')!

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
    expect(switcher.canSwitch(null)).toBe(true)
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
    expect(switcher.canSwitch(null)).toBe(false)
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
    expect(switcher.canSwitch(null)).toBe(false)
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
    expect(switcher.canSwitch(null)).toBe(false)
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
    expect(switcher.canSwitch(new Error('reverted onchain'))).toBe(false)
  })
})
