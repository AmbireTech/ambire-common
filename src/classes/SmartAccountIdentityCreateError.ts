import { SmartAccountIdentityCreateRequest } from '../interfaces/account'

export default class SmartAccountIdentityCreateError extends Error {
  smartAccountIdentityRequests: SmartAccountIdentityCreateRequest[] = []

  constructor(smartAccountIdentityRequests: SmartAccountIdentityCreateRequest[]) {
    super()
    this.name = 'SmartAccountIdentityCreateError'
    this.smartAccountIdentityRequests = smartAccountIdentityRequests
  }
}
