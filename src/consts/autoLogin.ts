export const DEFAULT_AUTO_LOGIN_DURATION_OPTION = {
  label: '30 days',
  value: 30 * 24 * 60 * 60 * 1000
}

// Implemented here to ensure consistency between the controller and the UI
// Also, in the future when the duration setting becomes exposed to the UI we
// will need to validate the input from the UI, so these will be useful
export const AUTO_LOGIN_DURATION_OPTIONS = [
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
  {
    label: '7 days',
    value: 7 * 24 * 60 * 60 * 1000
  },
  {
    label: '14 days',
    value: 14 * 24 * 60 * 60 * 1000
  },
  DEFAULT_AUTO_LOGIN_DURATION_OPTION
]
