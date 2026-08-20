import { produceMemoryStore } from '../../../test/helpers'
import { RailgunActivityEntry } from '../../interfaces/railgun'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { StorageController } from '../storage/storage'
import { RailgunController } from './railgun'

// The Kohaku SDK ships as ESM and its WASM entry point cannot be loaded under Jest's transform.
// Nothing here reaches into it: the shield-tracking path reads and writes the activity log only.
jest.mock('@kohaku-eth/railgun', () => ({}), { virtual: true })
jest.mock('@kohaku-eth/plugins', () => ({}), { virtual: true })

/**
 * Only the shield-tracking path is exercised here, which needs nothing from the SDK: it reads and
 * writes the activity log and nothing else. So the dependencies are stubs that load and never
 * change, rather than real controllers - building those would pull in the WASM module, a keystore
 * with a recovery phrase and live RPC providers for behaviour none of these tests touch.
 */
const prepareTest = async () => {
  const neverUpdates = { initialLoadPromise: Promise.resolve(), onUpdate: () => () => {} }
  const storage = new StorageController(produceMemoryStore())

  const controller = new RailgunController({
    keystore: { ...neverUpdates, isUnlocked: true, keys: [], keystoreSeeds: [] } as any,
    networks: { ...neverUpdates, networks: [] } as any,
    providers: { ...neverUpdates, providers: {} } as any,
    selectedAccount: { ...neverUpdates, account: null } as any,
    storage,
    fetch: (() => Promise.reject(new Error('nothing is fetched in these tests'))) as any,
    loadWasm: () => Promise.reject(new Error('the WASM module is never loaded in these tests')),
    sendUiMessage: () => {}
  })
  await controller.initialLoadPromise

  return { controller, storage }
}

const SHIELD_ACTIVITY_ID = '1-shield-0xtoken-1700000000000'

const buildShieldEntry = (overrides: Partial<RailgunActivityEntry> = {}): RailgunActivityEntry => ({
  id: SHIELD_ACTIVITY_ID,
  chainId: '1',
  type: 'shield',
  tokenAddress: '0xtoken',
  isNative: false,
  amount: 1000n,
  recipient: null,
  status: 'pending',
  createdAt: 1700000000000,
  ...overrides
})

const buildAccountOp = (meta: AccountOp['meta'], status?: AccountOpStatus): SubmittedAccountOp =>
  ({ accountAddr: '0xacc', chainId: 1n, calls: [], meta, status }) as unknown as SubmittedAccountOp

const TAGGED = { railgunShieldActivityId: SHIELD_ACTIVITY_ID }

describe('RailgunController shield tracking', () => {
  it('records when the shield transaction was signed and sent', async () => {
    const { controller } = await prepareTest()
    controller.activity = [buildShieldEntry()]

    controller.handleShieldBroadcasted(buildAccountOp(TAGGED))

    expect(controller.activity[0]!.broadcastedAt).toEqual(expect.any(Number))
    expect(controller.activity[0]!.status).toBe('pending')
  })

  it('ignores an account op that carries no shield', async () => {
    const { controller } = await prepareTest()
    controller.activity = [buildShieldEntry()]

    controller.handleShieldBroadcasted(buildAccountOp({}))
    controller.handleShieldBroadcasted(buildAccountOp({ railgunShieldActivityId: 'other-id' }))
    await controller.handleShieldAccountOpStatusUpdate(buildAccountOp({}, AccountOpStatus.Success))

    expect(controller.activity[0]).toEqual(buildShieldEntry())
  })

  it('resolves the shield and refreshes the pool once its transaction confirms', async () => {
    const { controller } = await prepareTest()
    const sync = jest.spyOn(controller, 'sync').mockResolvedValue(undefined)
    jest.spyOn(controller, 'isInitialized', 'get').mockReturnValue(true)
    controller.activity = [buildShieldEntry({ broadcastedAt: 1700000001000 })]

    await controller.handleShieldAccountOpStatusUpdate(
      buildAccountOp(TAGGED, AccountOpStatus.Success)
    )

    expect(controller.activity[0]!.status).toBe('success')
    // The shielded balance is what the user is sent back to look at, and it is a scan away
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('still resolves the shield when there is no live pool to scan with', async () => {
    const { controller } = await prepareTest()
    const sync = jest.spyOn(controller, 'sync').mockResolvedValue(undefined)
    controller.activity = [buildShieldEntry({ broadcastedAt: 1700000001000 })]

    await controller.handleShieldAccountOpStatusUpdate(
      buildAccountOp(TAGGED, AccountOpStatus.Success)
    )

    expect(controller.activity[0]!.status).toBe('success')
    // A scan without a plugin can only fail, and the periodic refresh covers it
    expect(sync).not.toHaveBeenCalled()
  })

  it.each([AccountOpStatus.Failure, AccountOpStatus.Rejected, AccountOpStatus.UnknownButPastNonce])(
    'fails the shield when its transaction ends as %s',
    async (status) => {
      const { controller } = await prepareTest()
      const sync = jest.spyOn(controller, 'sync').mockResolvedValue(undefined)
      controller.activity = [buildShieldEntry({ broadcastedAt: 1700000001000 })]

      await controller.handleShieldAccountOpStatusUpdate(buildAccountOp(TAGGED, status))

      expect(controller.activity[0]!.status).toBe('failed')
      expect(controller.activity[0]!.error).toBe(
        'The transaction did not go through, so nothing was shielded.'
      )
      expect(sync).not.toHaveBeenCalled()
    }
  )

  it.each([AccountOpStatus.BroadcastButStuck, AccountOpStatus.PartiallyComplete])(
    'leaves the shield pending on %s, since it can still land',
    async (status) => {
      const { controller } = await prepareTest()
      controller.activity = [buildShieldEntry({ broadcastedAt: 1700000001000 })]

      await controller.handleShieldAccountOpStatusUpdate(buildAccountOp(TAGGED, status))

      expect(controller.activity[0]!.status).toBe('pending')
    }
  )

  it('fails the shield when the user rejects its transaction', async () => {
    const { controller } = await prepareTest()
    controller.activity = [buildShieldEntry()]

    controller.handleShieldNotBroadcasted(buildAccountOp(TAGGED), 'rejected')

    expect(controller.activity[0]!.status).toBe('failed')
    expect(controller.activity[0]!.error).toBe(
      'You rejected the transaction, so nothing was shielded.'
    )
  })

  it('fails the shield when its transaction could not be sent', async () => {
    const { controller } = await prepareTest()
    controller.activity = [buildShieldEntry()]

    controller.handleShieldNotBroadcasted(buildAccountOp(TAGGED), 'broadcast-failed')

    expect(controller.activity[0]!.status).toBe('failed')
    expect(controller.activity[0]!.error).toBe(
      'The transaction could not be sent, so nothing was shielded.'
    )
  })

  it('never revisits a shield that has already been resolved', async () => {
    const { controller } = await prepareTest()
    const resolved = buildShieldEntry({ status: 'success' })
    controller.activity = [resolved]

    controller.handleShieldNotBroadcasted(buildAccountOp(TAGGED), 'rejected')
    await controller.handleShieldAccountOpStatusUpdate(
      buildAccountOp(TAGGED, AccountOpStatus.Failure)
    )

    expect(controller.activity[0]).toEqual(resolved)
  })

  it('leaves the other entries in the log untouched', async () => {
    const { controller } = await prepareTest()
    const otherShield = buildShieldEntry({ id: 'another-shield' })
    controller.activity = [buildShieldEntry(), otherShield]

    controller.handleShieldNotBroadcasted(buildAccountOp(TAGGED), 'rejected')

    expect(controller.activity[0]!.status).toBe('failed')
    expect(controller.activity[1]).toEqual(otherShield)
  })
})
