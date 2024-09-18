export {}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SEED: string
      SOCKET_API_KEY: string
    }
  }
}
