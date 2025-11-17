import { ControllerInterface } from './controller'

export type IPhishingController = ControllerInterface<
  InstanceType<typeof import('../controllers/phishing/phishing').PhishingController>
>

export interface BlacklistedStatuses {
  [item: string]: {
    status: BlacklistedStatus
    updatedAt: number
  }
}

export type BlacklistedStatus = 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
