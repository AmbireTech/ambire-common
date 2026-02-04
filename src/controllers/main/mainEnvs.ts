import { EventEmitterRegistryController } from '../../controllers/eventEmitterRegistry/eventEmitterRegistry'
import EventEmitter from '../eventEmitter/eventEmitter'
import { MainController } from './main'

export class ExtensionMainController extends MainController {
  constructor(args: ConstructorParameters<typeof MainController>[0]) {
    super(args)
  }
}

export class MobileMainController extends MainController {
  constructor(args: ConstructorParameters<typeof MainController>[0]) {
    super(args)
  }
}

export class RewardsMainController extends EventEmitter {
  providers: MainController['providers']

  domains: MainController['domains']

  contractNames: MainController['contractNames']

  ui: MainController['ui']

  initialLoadPromise?: MainController['initialLoadPromise']

  isReady: MainController['isReady'] = false

  constructor(args: ConstructorParameters<typeof MainController>[0]) {
    super(args.eventEmitterRegistry)

    args.featureFlags = {
      ...args.featureFlags,
      withContinuousUpdatesController: false
    }

    const mainCtrl = new MainController(args)

    this.providers = mainCtrl.providers
    this.domains = mainCtrl.domains
    this.contractNames = mainCtrl.contractNames
    this.ui = mainCtrl.ui
    this.initialLoadPromise = mainCtrl.initialLoadPromise
    this.isReady = mainCtrl.isReady

    mainCtrl.onUpdate((forceEmit) => {
      this.isReady = mainCtrl.isReady

      this.propagateUpdate(forceEmit)
    })
  }
}

export class ExplorerMainController extends EventEmitter {
  providers: MainController['providers']

  domains: MainController['domains']

  contractNames: MainController['contractNames']

  ui: MainController['ui']

  isReady: MainController['isReady'] = false

  constructor(args: ConstructorParameters<typeof MainController>[0]) {
    super(args.eventEmitterRegistry)

    args.featureFlags = {
      ...args.featureFlags,
      withContinuousUpdatesController: false
    }

    const eventEmitterRegistry = new EventEmitterRegistryController(() => {})
    const mainCtrl = new MainController({ ...args, eventEmitterRegistry })

    this.providers = mainCtrl.providers
    this.domains = mainCtrl.domains
    this.contractNames = mainCtrl.contractNames
    this.ui = mainCtrl.ui
    this.isReady = mainCtrl.isReady

    mainCtrl.onUpdate((forceEmit) => {
      this.isReady = mainCtrl.isReady

      this.propagateUpdate(forceEmit)
    })

    // Clean up unused controllers and properties to save memory in Explorer mode
    const exposedKeys = Object.keys(this)
    console.log('exposedKeys', exposedKeys)
    const allowedKeys = [...exposedKeys]

    // Destroy all event emitters to prevent memory leaks and clean up listeners
    eventEmitterRegistry.values().forEach((ctrl) => {
      ctrl.destroy()
    })

    Object.keys(mainCtrl).forEach((key) => {
      const value = (mainCtrl as any)[key]
      if (
        (!allowedKeys.includes(key) &&
          !key.startsWith('__') &&
          !key.startsWith('#') &&
          typeof value === 'object' &&
          value !== null) ||
        key === 'initialLoadPromise'
      ) {
        delete (mainCtrl as any)[key]
      }
    })
    console.log('mainCtrl', mainCtrl.toJSON())
  }
}
