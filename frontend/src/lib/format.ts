// Number formatting. Missing data is shown as a hyphen, never as zero: no data is not a value.
export const NO_DATA = '-'

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`
  if (value >= 10) return `${Math.round(value)} ms`
  return `${value.toFixed(1)} ms`
}

export function rate(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}/s`
}

export function percent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return NO_DATA
  const value = ratio * 100
  return `${value === 0 ? '0' : value < 1 ? value.toFixed(2) : value.toFixed(1)}%`
}

export function clock(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function shortId(id: string, length = 8): string {
  return id.slice(0, length)
}
