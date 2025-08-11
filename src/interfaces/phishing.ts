import { ControllerInterface } from './controller'

export type IPhishingController = ControllerInterface<
  InstanceType<typeof import('../controllers/phishing/phishing').PhishingController>
>

export type StoredPhishingDetection = {
  timestamp: number
  metamaskBlacklist: string[]
  phantomBlacklist: string[]
} | null
