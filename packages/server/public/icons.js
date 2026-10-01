const shapes = {
  overview: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }],
  ],
  review: [
    [
      'path',
      {
        d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z M14 3v6h6 M8 15l3 3 5-6',
      },
    ],
  ],
  content: [
    [
      'path',
      {
        d: 'M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z M3 7h10',
      },
    ],
  ],
  connect: [
    ['path', { d: 'M9 15l6-6 M8 12l-3 3a4 4 0 0 0 6 6l3-3 M16 12l3-3a4 4 0 0 0-6-6l-3 3' }],
  ],
  languages: [
    [
      'path',
      { d: 'M3 5h11 M8 3v2 M12 5c-1 6-4 9-8 11 M5 8c1 4 4 7 7 8 M13 21l4-10 4 10 M15 17h4' },
    ],
  ],
  settings: [
    [
      'path',
      {
        d: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
      },
    ],
    ['circle', { cx: 12, cy: 12, r: 6 }],
    ['circle', { cx: 12, cy: 12, r: 2 }],
  ],
  'sign-out': [['path', { d: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4 M9 12h12 M17 8l4 4-4 4' }]],
  'arrow-right': [['path', { d: 'M4 12h16 M14 6l6 6-6 6' }]],
  'arrow-left': [['path', { d: 'M20 12H4 M10 6l-6 6 6 6' }]],
  external: [
    [
      'path',
      { d: 'M14 3h7v7 M21 3l-9 9 M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5' },
    ],
  ],
  plus: [['path', { d: 'M12 5v14 M5 12h14' }]],
  close: [['path', { d: 'M6 6l12 12 M18 6 6 18' }]],
  check: [['path', { d: 'M5 12l4 4 10-10' }]],
  shield: [['path', { d: 'M12 3 3 7v5c0 5 4 8 9 10 5-2 9-5 9-10V7l-9-4Z M8 12l3 3 5-6' }]],
  file: [
    [
      'path',
      {
        d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z M14 3v6h6 M8 13h8 M8 17h5',
      },
    ],
  ],
  copy: [
    ['rect', { x: 8, y: 8, width: 13, height: 13, rx: 2 }],
    ['path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' }],
  ],
  download: [['path', { d: 'M12 3v12 M7 10l5 5 5-5 M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }]],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3 2' }],
  ],
  key: [
    ['circle', { cx: 8, cy: 8, r: 5 }],
    ['path', { d: 'M11.5 11.5 21 21 M16 16l3-3 M18 18l3-3' }],
  ],
  refresh: [
    ['path', { d: 'M20 7V3 M20 7h-4 M4 17v4 M4 17h4 M20 7a9 9 0 0 0-16 1 M4 17a9 9 0 0 0 16-1' }],
  ],
};

/** A single local vector vocabulary keeps controls consistent without font glyphs or remote scripts. */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icon',
  }))
    svg.setAttribute(key, value);
  for (const [tag, attributes] of shapes[name] ?? shapes.file) {
    const shape = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}

export function hydrateIcons(root) {
  for (const node of root.querySelectorAll('[data-icon]'))
    node.replaceChildren(icon(node.dataset.icon));
}
