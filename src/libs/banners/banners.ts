import { Account } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { UserRequest } from '../../interfaces/userRequest'
import { getNetworksWithFailedRPC } from '../settings/settings'

export const getMessageBanners = ({ userRequests }: { userRequests: UserRequest[] }) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  userRequests.forEach((req: UserRequest) => {
    if (req.action.kind === 'message' || req.action.kind === 'typedMessage') {
      txnBanners.push({
        id: req.id,
        topic: 'TRANSACTION',
        title: 'Message waiting to be signed',
        text: `Message type: ${req.action.kind === 'message' ? 'personal_sign' : 'typed_data'}`, // TODO:
        actions: [
          {
            label: 'Reject',
            actionName: 'reject',
            meta: { ids: [req.id], err: 'User rejected the transaction request' }
          },
          {
            label: 'Open',
            actionName: 'open',
            meta: { ids: [req.id] }
          }
        ]
      })
    }
  })

  return txnBanners
}

export const getAccountOpBannersForEOA = ({
  userRequests,
  accounts
}: {
  userRequests: UserRequest[]
  accounts: Account[]
}): Banner[] => {
  if (!userRequests) return []

  const activeUserRequest = userRequests.find((req: UserRequest) => {
    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    return req.action.kind === 'call' && !account?.creation
  })

  if (!activeUserRequest) return []

  return [
    {
      id: activeUserRequest.id,
      topic: 'TRANSACTION',
      title: 'Transaction waiting to be signed',
      text: '', // TODO:
      actions: [
        {
          label: 'Open',
          actionName: 'open',
          meta: { ids: [activeUserRequest.id] }
        },
        {
          label: 'Reject',
          actionName: 'reject',
          meta: { ids: [activeUserRequest.id], err: 'User rejected the transaction request' }
        }
      ]
    } as Banner
  ]
}

export const getPendingAccountOpBannersForEOA = ({
  userRequests,
  accounts
}: {
  userRequests: UserRequest[]
  accounts: Account[]
}): Banner[] => {
  if (!userRequests) return []

  const pendingUserRequests: UserRequest[] = userRequests.filter((req: UserRequest) => {
    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    return req.action.kind === 'call' && !account?.creation
  })

  const numberOfPendingRequest = pendingUserRequests.length - 1
  if (numberOfPendingRequest <= 0) return []

  return [
    {
      id: pendingUserRequests[0].id,
      topic: 'TRANSACTION',
      title: `${numberOfPendingRequest} More pending transactions are waiting to be signed`,
      text: '' // TODO:
    } as Banner
  ]
}

export const getAccountOpBannersForSmartAccount = ({
  userRequests,
  accounts
}: {
  userRequests: UserRequest[]
  accounts: Account[]
}) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  const groupedRequests = userRequests.reduce((acc: any, userRequest: UserRequest) => {
    const key = `${userRequest.accountAddr}-${userRequest.networkId}`

    if (!acc[key]) {
      acc[key] = []
    }
    const account = accounts.find((a) => a.addr === userRequest.accountAddr) || ({} as Account)
    if (userRequest.action.kind === 'call' && account.creation) {
      acc[key].push(userRequest)
    }

    return acc
  }, {})

  const groupedRequestsArray: UserRequest[][] = (
    (Object.values(groupedRequests || {}) || []) as UserRequest[][]
  ).filter((group: any) => group.length)

  groupedRequestsArray.forEach((group) => {
    txnBanners.push({
      id: group[0].id,
      topic: 'TRANSACTION',
      title: `${group.length} Transactions waiting to be signed`,
      text: '', // TODO:
      actions: [
        {
          label: 'Open',
          actionName: 'open',
          meta: { ids: [group[0].id] }
        },
        {
          label: 'Reject',
          actionName: 'reject',
          meta: { ids: group.map((g) => g.id), err: 'User rejected the transaction request' }
        }
      ]
    })
  })

  return txnBanners
}

export const getKeySyncBanner = (addr: string, email: string, keys: string[]) => {
  const banner: Banner = {
    id: `${addr}:${email}:${JSON.stringify(keys)}:${Math.random()}`,
    accountAddr: addr,
    topic: 'ANNOUNCEMENT',
    title: 'Sync Key Store keys',
    text: 'This account has no signing keys added therefore it is in a view-only mode. Make a request for keys sync from another device.',
    actions: [
      {
        label: 'Sync',
        actionName: 'sync-keys',
        meta: { email, keys }
      }
    ]
  }
  return banner
}

export const getNetworksWithFailedRPCBanners = ({
  providers,
  networks,
  networksWithAssets
}: {
  providers: RPCProviders
  networks: NetworkDescriptor[]
  networksWithAssets: NetworkDescriptor['id'][]
}): Banner[] => {
  return getNetworksWithFailedRPC({ providers })
    .filter((networkId) => networksWithAssets.includes(networkId))
    .map((network) => {
      const networkData = networks.find((n: NetworkDescriptor) => n.id === network)!

      return {
        id: `${networkData.id}-${new Date().getTime()}`,
        topic: 'WARNING',
        title: `Failed to retrieve network data for ${networkData?.name}(RPC error)`,
        text: `Affected features(${networkData?.name}): visible tokens, sign message/transaction, ENS/UD domain resolving, add account. Please try again later or contact support.`,
        actions: []
      }
    })
}
