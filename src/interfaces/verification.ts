import { ControllerInterface } from './controller'

export type VerificationStatus = 'not-configured' | 'syncing' | 'ready' | 'failed'

export type NetworkVerificationStatus = {
  status: VerificationStatus
  error?: string
  updatedAt?: number
}

export type VerificationStatuses = {
  [chainId: string]: NetworkVerificationStatus | undefined
}

export type IVerificationController = ControllerInterface<
  InstanceType<typeof import('../controllers/verification/verification').VerificationController>
>
