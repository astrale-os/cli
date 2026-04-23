import { describe, expect, test } from 'bun:test'

import { parseCloudflaredIngress } from '../adopt'

describe('parseCloudflaredIngress', () => {
  test('extracts a single hostname', () => {
    const yaml = `
tunnel: kernel-e2e
credentials-file: /tmp/cred.json

ingress:
  - hostname: example.local.astrale.ai
    service: http://localhost:4400
  - service: http_status:404
`
    expect(parseCloudflaredIngress(yaml)).toEqual(['example.local.astrale.ai'])
  })

  test('extracts multiple distinct hostnames', () => {
    const yaml = `
ingress:
  - hostname: a.example.com
    service: http://localhost:4400
  - hostname: b.example.com
    service: http://localhost:8787
  - service: http_status:404
`
    expect(parseCloudflaredIngress(yaml)).toEqual(['a.example.com', 'b.example.com'])
  })

  test('skips wildcard hostnames', () => {
    const yaml = `
ingress:
  - hostname: "*.fn.dist.example.ai"
    service: http://localhost:8787
  - hostname: dist.example.ai
    service: http://localhost:8787
`
    expect(parseCloudflaredIngress(yaml)).toEqual(['dist.example.ai'])
  })

  test('strips inline comments', () => {
    const yaml = `
ingress:
  - hostname: ok.example.com  # primary
    service: http://localhost:4400
`
    expect(parseCloudflaredIngress(yaml)).toEqual(['ok.example.com'])
  })

  test('returns empty when no ingress block is present', () => {
    expect(parseCloudflaredIngress(`tunnel: foo\ncredentials-file: /tmp/c.json\n`)).toEqual([])
  })

  test('leaves the ingress block when a new top-level key appears', () => {
    const yaml = `
ingress:
  - hostname: real.example.com
    service: http://localhost:4400

other-top-key:
  - hostname: ignored.example.com
`
    expect(parseCloudflaredIngress(yaml)).toEqual(['real.example.com'])
  })
})
