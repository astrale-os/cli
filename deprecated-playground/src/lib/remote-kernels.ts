const STORAGE_KEY = 'astrale:remote-kernels'

export type RemoteKernel = {
  slug: string
  name: string
  url: string
  createdAt: string
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function isValidWsUrl(url: string): boolean {
  return /^wss?:\/\/.+/.test(url)
}

export function getRemoteKernels(): RemoteKernel[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function getRemoteKernel(slug: string): RemoteKernel | undefined {
  return getRemoteKernels().find((k) => k.slug === slug)
}

export function addRemoteKernel(name: string, url: string): RemoteKernel {
  const kernels = getRemoteKernels()
  const kernel: RemoteKernel = {
    slug: toSlug(name),
    name,
    url,
    createdAt: new Date().toISOString(),
  }
  kernels.push(kernel)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kernels))
  return kernel
}

export function removeRemoteKernel(slug: string): void {
  const kernels = getRemoteKernels().filter((k) => k.slug !== slug)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kernels))
}
