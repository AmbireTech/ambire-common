export interface Storage {
  get(key: string | null, defaultValue: any): Promise<any>
  set(key: string, value: any): Promise<null>
  remove(key: string): Promise<null>
}
