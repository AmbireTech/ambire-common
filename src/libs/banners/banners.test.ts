import { describe, expect, test } from '@jest/globals'

import { Account, SafeAccountCreation } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { DappConnectRequest, PlainTextMessageUserRequest } from '../../interfaces/userRequest'
import {
  getIntentBanners,
  getCurrentAccountBanners,
  getDappUserRequestsBanners,
  getSafeMessageRequestBanners
} from './banners'

const ACCOUNT_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const OTHER_ACCOUNT_ADDR = '0x8888888888888888888888888888888888888a'

const account: Account = {
  addr: ACCOUNT_ADDR,
  associatedKeys: [],
  initialPrivileges: [],
  creation: null,
  preferences: { label: '', pfp: '' }
}

describe('getCurrentAccountBanners', () => {
  test('keeps only banners matching the selected account', () => {
    const banners: Banner[] = [
      { id: 1, type: 'info', title: '', actions: [], meta: { accountAddr: ACCOUNT_ADDR } },
      { id: 2, type: 'info', title: '', actions: [], meta: { accountAddr: OTHER_ACCOUNT_ADDR } }
    ]

    expect(getCurrentAccountBanners(banners, ACCOUNT_ADDR)).toEqual([banners[0]])
  })

  test('keeps banners without meta.accountAddr regardless of the selected account', () => {
    const globalBanner: Banner = { id: 'global', type: 'info', title: '', actions: [] }

    expect(getCurrentAccountBanners([globalBanner], ACCOUNT_ADDR)).toEqual([globalBanner])
    expect(getCurrentAccountBanners([globalBanner], undefined)).toEqual([globalBanner])
  })
})

describe('getDappUserRequestsBanners', () => {
  test('tags the banner with the account it was built for', () => {
    const dappConnectRequest: DappConnectRequest = {
      id: 1,
      kind: 'dappConnect',
      meta: {},
      dappPromises: [
        {
          id: 'testID',
          resolve: () => {},
          reject: () => {},
          session: {} as DappConnectRequest['dappPromises'][0]['session'],
          meta: {}
        }
      ]
    }

    const banners = getDappUserRequestsBanners(account, [dappConnectRequest])

    expect(banners).toHaveLength(1)
    expect(banners[0]!.meta?.accountAddr).toEqual(ACCOUNT_ADDR)
  })
})

describe('getSafeMessageRequestBanners', () => {
  test('tags the banner with the Safe account it was built for', () => {
    const safeCreation: SafeAccountCreation = {
      factoryAddr: '0x0',
      singleton: '0x0',
      saltNonce: '0x0',
      setupData: '0x0',
      version: '1.4.1'
    }
    const safeAccount: Account = { ...account, safeCreation }
    const messageRequest: PlainTextMessageUserRequest = {
      id: 1,
      kind: 'message',
      meta: {
        params: { message: '0x0' },
        accountAddr: ACCOUNT_ADDR,
        chainId: 1n
      },
      dappPromises: []
    }

    const banners = getSafeMessageRequestBanners(safeAccount, [messageRequest])

    expect(banners).toHaveLength(1)
    expect(banners[0]!.meta?.accountAddr).toEqual(ACCOUNT_ADDR)
    expect(banners[0]!.title).toEqual('Pending signature request')
    expect(
      getSafeMessageRequestBanners(safeAccount, [messageRequest, messageRequest])[0]!.title
    ).toEqual('Pending signature requests')
  })
})

describe('getIntentBanners', () => {
  test('tags the banner with the account the active routes belong to', () => {
    const activeRoutes: SwapAndBridgeActiveRoute[] = [
      {
        serviceProviderId: 'lifi',
        fromAssetAddress: '0x0',
        toAssetAddress: '0x0',
        steps: [],
        sender: ACCOUNT_ADDR,
        activeRouteId: 'route-1',
        userTxIndex: 0,
        userTxHash: null,
        identifiedBy: null,
        // Only the fields getIsIntentRoute/getIntentBanners actually read are filled in.
        route: {
          routeStatus: 'in-progress',
          fromChainId: 1,
          toChainId: 10,
          currentUserTxIndex: 0,
          transactionData: null,
          userAddress: ACCOUNT_ADDR
        } as unknown as SwapAndBridgeActiveRoute['route'],
        routeStatus: 'in-progress'
      }
    ]

    const banners = getIntentBanners(activeRoutes, [], ACCOUNT_ADDR)

    expect(banners).toHaveLength(1)
    expect(banners[0]!.meta?.accountAddr).toEqual(ACCOUNT_ADDR)
  })

  test('shows a swap banner for a same-network intent', () => {
    const activeRoutes = [
      {
        serviceProviderId: 'cowswap',
        fromAssetAddress: '0x0',
        toAssetAddress: '0x0',
        steps: [],
        sender: ACCOUNT_ADDR,
        activeRouteId: 'route-1',
        userTxIndex: 0,
        userTxHash: '0x1',
        identifiedBy: null,
        route: {
          routeStatus: 'in-progress',
          fromChainId: 1,
          toChainId: 1,
          currentUserTxIndex: 0,
          transactionData: null,
          userAddress: ACCOUNT_ADDR,
          isIntent: true
        } as unknown as SwapAndBridgeActiveRoute['route'],
        routeStatus: 'in-progress' as const
      }
    ]

    const banners = getIntentBanners(activeRoutes, [], ACCOUNT_ADDR)

    expect(banners[0]!.title).toBe('Swap in progress')
    expect(banners[0]!.text).toBe('You have 1 pending swap')
  })
})
