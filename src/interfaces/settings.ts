export interface Settings {
  shouldDisable7702Popup(accAddr: string): boolean
  setShouldDisable7702Popup(accAddr: string, shouldDisable: boolean): void
}
