import { expect, jest } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../storage/storage'
import {
  INVALID_CODE_MESSAGE,
  INVITE_STATUS,
  InviteController,
  UNREACHABLE_MESSAGE
} from './invite'

// Never actually requested - every controller below is built with a mocked fetch. It points at
// staging anyway, so that a test that forgets to mock can't reach the production relayer.
const RELAYER_URL = 'https://staging-relayer.ambire.com'

// Made up, in the shape of a real code (12 characters), but never valid anywhere.
const DUMMY_CODE = 'dummyinvite1'
const ANOTHER_DUMMY_CODE = 'dummyinvite2'

const makeController = (fetch: any) =>
  new InviteController({
    relayerUrl: RELAYER_URL,
    fetch,
    storage: new StorageController(produceMemoryStore())
  })

const mockFetch = (status: number, body: object) =>
  jest.fn(async () => ({
    status,
    text: async () => JSON.stringify(body)
  })) as any

describe('InviteController - the invite gate', () => {
  it('unlocks the app with a valid code', async () => {
    const ctrl = makeController(mockFetch(200, { success: true }))

    await ctrl.verify(DUMMY_CODE)

    expect(ctrl.inviteStatus).toBe(INVITE_STATUS.VERIFIED)
    expect(ctrl.verifiedCode).toBe(DUMMY_CODE)
  })

  it('keeps the app locked and shows what the relayer said about the code', async () => {
    const relayerMessage = 'The key you entered is invalid.'
    // The relayer rejects a code with a 200 and success: false, not with an error status.
    const ctrl = makeController(mockFetch(200, { success: false, message: relayerMessage }))
    const emittedErrors: string[] = []
    ctrl.onError(() => {
      const lastError = ctrl.emittedErrors.at(-1)
      if (lastError) emittedErrors.push(lastError.message)
    })

    await ctrl.verify(DUMMY_CODE)

    expect(ctrl.inviteStatus).toBe(INVITE_STATUS.UNVERIFIED)
    expect(ctrl.verifiedCode).toBeNull()
    // The screen reads it off the state, to show it in the form instead of in a toast.
    expect(ctrl.errorMessage).toBe(relayerMessage)
    expect(emittedErrors[0]).toBe(relayerMessage)
  })

  it('falls back to a generic message when the relayer rejects the code without saying why', async () => {
    const ctrl = makeController(mockFetch(200, { success: false }))

    await ctrl.verify(DUMMY_CODE)

    expect(ctrl.inviteStatus).toBe(INVITE_STATUS.UNVERIFIED)
    expect(ctrl.errorMessage).toBe(INVALID_CODE_MESSAGE)
  })

  it('never blames the code when the relayer could not be reached', async () => {
    const offlineCtrl = makeController(
      jest.fn(async () => Promise.reject(new Error('Network request failed')))
    )
    const downCtrl = makeController(mockFetch(503, { success: false, message: 'Bad gateway' }))
    const unreadableCtrl = makeController(
      jest.fn(async () => ({ status: 200, text: async () => '<html>not json</html>' })) as any
    )

    await offlineCtrl.verify(DUMMY_CODE)
    await downCtrl.verify(DUMMY_CODE)
    await unreadableCtrl.verify(DUMMY_CODE)

    expect(offlineCtrl.errorMessage).toBe(UNREACHABLE_MESSAGE)
    expect(downCtrl.errorMessage).toBe(UNREACHABLE_MESSAGE)
    expect(unreadableCtrl.errorMessage).toBe(UNREACHABLE_MESSAGE)
    expect(offlineCtrl.inviteStatus).toBe(INVITE_STATUS.UNVERIFIED)
    expect(downCtrl.inviteStatus).toBe(INVITE_STATUS.UNVERIFIED)
    expect(unreadableCtrl.inviteStatus).toBe(INVITE_STATUS.UNVERIFIED)
  })

  it('clears the error, so that the form stops showing it', async () => {
    const ctrl = makeController(mockFetch(200, { success: false }))

    await ctrl.verify(DUMMY_CODE)
    ctrl.resetErrorState()

    expect(ctrl.errorMessage).toBe('')
  })

  it('grants access without asking the relayer (for users who were already using the app)', async () => {
    const fetch = mockFetch(200, { success: true })
    const ctrl = makeController(fetch)

    await ctrl.grantAccess(ANOTHER_DUMMY_CODE)

    expect(ctrl.inviteStatus).toBe(INVITE_STATUS.VERIFIED)
    expect(ctrl.verifiedCode).toBe(ANOTHER_DUMMY_CODE)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not overwrite an already verified code when granting access', async () => {
    const ctrl = makeController(mockFetch(200, { success: true }))

    await ctrl.verify(DUMMY_CODE)
    await ctrl.grantAccess(ANOTHER_DUMMY_CODE)

    expect(ctrl.verifiedCode).toBe(DUMMY_CODE)
  })

  it('keeps the OG status when the gate is passed', async () => {
    const ctrl = makeController(mockFetch(200, { success: true }))

    await ctrl.becomeOG()
    await ctrl.verify(DUMMY_CODE)

    expect(ctrl.isOG).toBe(true)
    expect(ctrl.verifiedCode).toBe(DUMMY_CODE)
  })

  it('keeps the verified code when becoming an OG', async () => {
    const storage = new StorageController(produceMemoryStore())
    const ctrl = new InviteController({
      relayerUrl: RELAYER_URL,
      fetch: mockFetch(200, { success: true }),
      storage
    })

    await ctrl.verify(DUMMY_CODE)
    await ctrl.becomeOG()

    expect(await storage.get('invite', null)).toMatchObject({
      status: INVITE_STATUS.VERIFIED,
      verifiedCode: DUMMY_CODE
    })
  })
})
