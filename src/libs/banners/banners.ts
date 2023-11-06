import { Account } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { UserRequest } from '../../interfaces/userRequest'

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
      id: new Date().getTime(),
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
      id: new Date().getTime(),
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
