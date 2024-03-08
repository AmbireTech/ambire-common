export {}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SEED: string
    }
  }
}
