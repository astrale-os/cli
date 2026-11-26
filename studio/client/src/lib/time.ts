/** "just now" · "12 min ago" · "3 h ago" · "2 d ago" · "19 Aug". */
export function relativeTime(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days} d ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "in 4 min" · "in 3 h" · "in 2 d" · "19 Aug": how far ahead an instant is. */
export function untilTime(iso: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((at - Date.now()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours} h`
  const days = Math.round(hours / 24)
  if (days <= 7) return `in ${days} d`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
