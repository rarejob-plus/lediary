// Inline Lucide-style SVG icons (stroke-based, 24x24 viewBox).

const wrap = (path: string, size = 18): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const icons = {
  chevronDown: (s = 18) => wrap('<polyline points="6 9 12 15 18 9"/>', s),
  chevronLeft: (s = 18) => wrap('<polyline points="15 18 9 12 15 6"/>', s),
  chevronRight: (s = 18) => wrap('<polyline points="9 18 15 12 9 6"/>', s),
  pencil: (s = 18) => wrap('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>', s),
  trash: (s = 18) => wrap('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', s),
  share: (s = 18) => wrap('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>', s),
  more: (s = 18) => wrap('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', s),
  plus: (s = 18) => wrap('<path d="M5 12h14"/><path d="M12 5v14"/>', s),
  x: (s = 18) => wrap('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', s),
  pen: (s = 18) => wrap('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>', s),
  calendar: (s = 18) => wrap('<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>', s),
  clock: (s = 18) => wrap('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', s),
  mapPin: (s = 18) => wrap('<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', s),
  sun: (s = 18) => wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', s),
  graduation: (s = 18) => wrap('<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>', s),
  moon: (s = 18) => wrap('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', s),
  bookOpen: (s = 18) => wrap('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>', s),
  flame: (s = 18) => wrap('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', s),
  check: (s = 18) => wrap('<path d="M20 6 9 17l-5-5"/>', s),
  // Play / pause — fill=currentColor で塗りつぶしたい（outline だと細くて視認性が悪い）
  play: (s = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor">` +
    `<polygon points="7 4 20 12 7 20"/></svg>`,
  pause: (s = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor">` +
    `<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
  // Lucide circle (outline). 空のスコアドット用。
  circle: (s = 18) => wrap('<circle cx="12" cy="12" r="10"/>', s),
  // 中身を currentColor で塗りつぶした円。filled スコアドット用。
  // viewBox 24x24 / r=10 はストローク幅 0 でも視覚的に同サイズに揃う。
  circleSolid: (s = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor">` +
    `<circle cx="12" cy="12" r="10"/></svg>`,
  // Lucide monitor (auto テーマ用)
  monitor: (s = 18) => wrap('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>', s),
  // Lucide mic (録音 / 発音採点用)
  mic: (s = 18) => wrap('<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>', s),
  // Lucide trophy (発音採点 Perfect バッジ)
  trophy: (s = 18) => wrap(
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>'
    + '<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>'
    + '<path d="M4 22h16"/>'
    + '<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>'
    + '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>'
    + '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    s,
  ),
  // Lucide thumbs-up (発音採点 Good バッジ)
  thumbsUp: (s = 18) => wrap(
    '<path d="M7 10v12"/>'
    + '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    s,
  ),
  // Lucide volume-2 (シャドーイング再生音量)
  volume2: (s = 18) => wrap(
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.384 3.384A.705.705 0 0 0 11 19.298z"/>'
    + '<path d="M16 9a5 5 0 0 1 0 6"/>'
    + '<path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    s,
  ),
  // Lucide sparkles (1 フレーズ・フレーズ集ナビ用)
  sparkles: (s = 18) => wrap(
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'
    + '<path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    s,
  ),
  // Lucide eye-off (focus mode toggle)
  eyeOff: (s = 18) => wrap(
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>'
    + '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>'
    + '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>'
    + '<path d="m2 2 20 20"/>',
    s,
  ),
  // Lucide refresh-cw (カバー差し替え用)
  refreshCw: (s = 18) => wrap(
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>'
    + '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
    s,
  ),
  eye: (s = 18) => wrap(
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>'
    + '<circle cx="12" cy="12" r="3"/>',
    s,
  ),
};
