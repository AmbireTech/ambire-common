export {}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SEED: string
      COINGECKO_PRO_API_KEY?: string
    }
  }
}
