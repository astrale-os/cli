import { describe, expect, test } from 'bun:test'

import { sanitizeSvg } from './sanitize-svg'

const LUCIDE_BOX =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-box"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>'

/** Nothing that can run code, load a resource or restyle the page survives. */
const ACTIVE =
  /script|\bon\w+\s*=|href|javascript|url\(|style|foreignObject|animate|<set|<use|<a[\s>]|<image|<iframe|<img/iu

describe('sanitizeSvg', () => {
  test('keeps a lucide icon and makes it fill its box', () => {
    const out = sanitizeSvg(LUCIDE_BOX)
    expect(out).toBe(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">' +
        '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
        '<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    )
  })

  test('keeps shapes, groups and transforms, and defaults the viewBox', () => {
    const out = sanitizeSvg(
      '<svg><g transform="rotate(45 12 12)"><circle cx="12" cy="12" r="10"/><rect x="2" y="2" width="4" height="4" rx="1"/><polyline points="1,2 3,4"/></g></svg>',
    )
    expect(out).toContain('viewBox="0 0 24 24"')
    expect(out).toContain('<g transform="rotate(45 12 12)">')
    expect(out).toContain('<circle cx="12" cy="12" r="10"/>')
    expect(out).toContain('<rect x="2" y="2" width="4" height="4" rx="1"/>')
    expect(out).toContain('<polyline points="1,2 3,4"/>')
  })

  test.each([
    ['script with a space before >', '<svg><script >alert(1)</script ><path d="M0 0"/></svg>'],
    ['upper-case script', '<svg><SCRIPT>alert(1)</SCRIPT></svg>'],
    ['quoted event handler', '<svg onload="alert(1)"><path d="M0 0" onclick=\'alert(1)\'/></svg>'],
    ['javascript link', '<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>'],
    [
      'xlink javascript link',
      '<svg><a xlink:href="javascript:alert(1)"><rect width="9"/></a></svg>',
    ],
    [
      'animate onto href',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
    ],
    ['set onto href', '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>'],
    [
      'foreignObject html',
      '<svg><foreignObject><img src="x" onerror="alert(1)"/></foreignObject></svg>',
    ],
    ['use of an external sprite', '<svg><use href="https://evil.test/s.svg#a"/></svg>'],
    [
      'style element',
      '<svg><style>*{background:url(https://evil.test)}</style><path d="M0 0"/></svg>',
    ],
    [
      'style attribute and url paint',
      '<svg><path d="M0 0" style="x" fill="url(https://evil.test/#p)"/></svg>',
    ],
    ['image', '<svg><image href="https://evil.test/p.png"/></svg>'],
    ['comment hiding markup', '<svg><!--<script>alert(1)</script>--><path d="M0 0"/></svg>'],
    ['quote confusion', "<svg><path d='M0 0\"><script>alert(1)</script>'/></svg>"],
    ['entity in a value', '<svg><path d="M0 0" fill="&#106;avascript:alert(1)"/></svg>'],
  ])('neutralizes %s', (_name, input) => {
    const out = sanitizeSvg(input)
    if (out !== null) expect(out).not.toMatch(ACTIVE)
  })

  test.each([
    ['unquoted handler', '<svg onload=alert(1)><path d="M0 0"/></svg>'],
    ['bare attribute', '<svg hidden><path d="M0 0"/></svg>'],
    ['CDATA section', '<svg><![CDATA[<script>alert(1)</script>]]></svg>'],
    ['doctype', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'],
    ['mismatched tags', '<svg><g><path d="M0 0"/></svg></g>'],
    ['unclosed svg', '<svg><path d="M0 0"/>'],
    ['not an svg', '<div><svg/></div>'],
    ['stray <', '<svg><path d="M0 0"/ <script>alert(1)</script></svg>'],
  ])('rejects %s', (_name, input) => {
    expect(sanitizeSvg(input)).toBeNull()
  })
})
