// Pip, the Pocket Box mascot: a round, fluffy little bunny in an oatmeal
// knit hood with round glasses — a cozy, clever helper. Drawn in SVG with
// soft shading and fuzzy fur so it stays crisp at any size.
// Pip.svg(mood, size) returns inline SVG. Moods: hi (waving), happy, think,
// sleep, wow, idle. Animation lives in CSS (.pip ...).
(function (root) {
  'use strict';
  let n = 0;
  function svg(mood = 'idle', size = 96, { still = false } = {}) {
    const k = `pip${++n}`;
    const ink = '#3b2626';
    const closed = mood === 'happy' || mood === 'sleep';
    const ey = mood === 'think' ? 71.5 : 74;
    const ew = mood === 'wow' ? 8 : 7;
    const eh = mood === 'wow' ? 9 : 8.2;
    const eyes = closed
      ? (mood === 'happy'
        ? `<path d="M40.5 75 Q47 68.5 53.5 75" /><path d="M66.5 75 Q73 68.5 79.5 75" />`
        : `<path d="M40.5 74 Q47 78.5 53.5 74" /><path d="M66.5 74 Q73 78.5 79.5 74" />`)
      : `<g class="pip-eyes">
          <ellipse cx="47" cy="${ey}" rx="${ew}" ry="${eh}" fill="url(#${k}e)" stroke="none"/>
          <ellipse cx="73" cy="${ey}" rx="${ew}" ry="${eh}" fill="url(#${k}e)" stroke="none"/>
          <circle cx="49.8" cy="${ey - 3.8}" r="2.9" fill="#fff" stroke="none"/><circle cx="75.8" cy="${ey - 3.8}" r="2.9" fill="#fff" stroke="none"/>
          <circle cx="44.6" cy="${ey + 3.6}" r="1.3" fill="#fff" opacity=".85" stroke="none"/><circle cx="70.6" cy="${ey + 3.6}" r="1.3" fill="#fff" opacity=".85" stroke="none"/>
        </g>`;
    const brows = `<path d="M42.5 62.5 Q46 60.4 49.5 62" stroke-width="1.4" opacity=".55"/><path d="M70.5 62 Q74 60.4 77.5 62.5" stroke-width="1.4" opacity=".55"/>`;
    const mouth = {
      happy: `<path d="M55.2 85.4 Q60 92.6 64.8 85.4 Q60 87.6 55.2 85.4Z" fill="#8e4a43" stroke="#8e4a43" stroke-width="1"/>`,
      hi: `<path d="M55.6 85.2 Q60 91.6 64.4 85.2 Q60 87.2 55.6 85.2Z" fill="#8e4a43" stroke="#8e4a43" stroke-width="1"/>`,
      wow: `<ellipse cx="60" cy="87.4" rx="3" ry="3.6" fill="#8e4a43" stroke="none"/>`,
      sleep: `<path d="M57.6 86.2 Q60 87.6 62.4 86.2" stroke-width="1.5"/>`,
      think: `<path d="M57 86.6 Q60 85.4 63.4 86.8" stroke-width="1.5"/>`,
    }[mood] || `<path d="M56.2 85 q1.9 2 3.8 0 q1.9 2 3.8 0" stroke-width="1.5"/>`;
    // Paws: held at the chest, or one raised to wave.
    const paw = (cx, cy, r = 6.6) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${k}c)"/><path d="M${cx - 2.6} ${cy + 1.6} v2 M${cx} ${cy + 2.2} v2 M${cx + 2.6} ${cy + 1.6} v2" stroke="#e3cfc2" stroke-width="1.1" stroke-linecap="round"/>`;
    const paws = mood === 'hi'
      ? `${paw(51, 108)}<g class="pip-arm"><path d="M84 104 Q100 98 106 84" stroke="url(#${k}h)" stroke-width="11" fill="none" stroke-linecap="round"/>${paw(108, 78, 7.6)}</g>`
      : mood === 'think' ? `${paw(51, 109)}<path d="M80 108 Q80 100 72 96" stroke="url(#${k}h)" stroke-width="10" fill="none" stroke-linecap="round"/>${paw(70, 95, 6.6)}`
        : `${paw(51, 108)}${paw(69, 108)}`;
    const extra = {
      sleep: `<g class="pip-z" fill="#7d8fb3" font-family="ui-rounded, system-ui, sans-serif" font-weight="800"><text x="92" y="44" font-size="15">z</text><text x="104" y="32" font-size="10">z</text></g>`,
      think: `<g class="pip-dots" fill="#7d8fb3"><circle cx="94" cy="50" r="3"/><circle cx="102" cy="42" r="3.8"/><circle cx="111" cy="33" r="4.6"/></g>`,
      wow: `<g fill="#ffcf5c"><path d="M12 62 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3z"/><path d="M103 56 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2z"/></g>`,
    }[mood] || '';
    const droop = mood === 'sleep' ? 1 : 0;
    return `<svg class="pip pip-${mood}${still ? ' still' : ''}" width="${size}" height="${Math.round(size * 1.12)}" viewBox="0 0 120 134" role="img" aria-label="Pip">
  <defs>
    <radialGradient id="${k}c" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fdf6ef"/><stop offset="1" stop-color="#e8d7cb"/></radialGradient>
    <radialGradient id="${k}h" cx=".35" cy=".22" r=".85"><stop offset="0" stop-color="#f7efe4"/><stop offset=".55" stop-color="#e6d6c2"/><stop offset="1" stop-color="#c9b398"/></radialGradient>
    <radialGradient id="${k}i" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#f1d6c8"/><stop offset="1" stop-color="#dfb8a6"/></radialGradient>
    <radialGradient id="${k}e" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#7a5348"/><stop offset=".55" stop-color="#3e2723"/><stop offset="1" stop-color="#1e1212"/></radialGradient>
    <radialGradient id="${k}b" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f29a86" stop-opacity=".5"/><stop offset="1" stop-color="#f29a86" stop-opacity="0"/></radialGradient>
    <filter id="${k}f" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>
  </defs>
  <ellipse cx="60" cy="129" rx="28" ry="4" fill="#3b2626" opacity=".1" class="pip-shadow"/>
  <g class="pip-body">
    <g class="pip-ears" filter="url(#${k}f)">
      <g transform="rotate(${-14 - droop * 30} 44 46)"><ellipse cx="44" cy="22" rx="11" ry="25" fill="url(#${k}c)"/><ellipse cx="44" cy="24" rx="5.6" ry="17" fill="url(#${k}i)"/></g>
      <g transform="rotate(${16 + droop * 34} 76 46)"><ellipse cx="76" cy="22" rx="11" ry="25" fill="url(#${k}c)"/><ellipse cx="76" cy="24" rx="5.6" ry="17" fill="url(#${k}i)"/></g>
    </g>
    <g filter="url(#${k}f)">
      <ellipse cx="44" cy="127" rx="10" ry="6" fill="url(#${k}c)"/><ellipse cx="76" cy="127" rx="10" ry="6" fill="url(#${k}c)"/>
      <path d="M33 104 Q33 96 42 95 L78 95 Q87 96 87 104 L89 120 Q89 128 80 128 L40 128 Q31 128 31 120 Z" fill="url(#${k}h)"/>
      <ellipse cx="60" cy="74" rx="45" ry="41" fill="url(#${k}h)"/>
      <ellipse cx="60" cy="76" rx="35.5" ry="32.5" fill="url(#${k}c)"/>
    </g>
    <g stroke="#c4ad91" stroke-width="1.2" fill="none" opacity=".55" stroke-linecap="round"><path d="M21 70 q2 -3 4 0"/><path d="M22 86 q2 -3 4 0"/><path d="M27 100 q2 -3 4 0"/><path d="M93 70 q2 -3 4 0"/><path d="M92 86 q2 -3 4 0"/><path d="M87 100 q2 -3 4 0"/><path d="M33 44 q2 -3 4 0"/><path d="M81 44 q2 -3 4 0"/><path d="M57 37 q2 -3 4 0"/></g>
    <path d="M24 62 Q30 40 52 34" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".55"/>
    <g class="pip-pocket"><path d="M49 112 h22 v6 a7 7 0 0 1 -7 7 h-8 a7 7 0 0 1 -7 -7z" fill="#d8c5ae" opacity=".7"/><path d="M49 112 h22" stroke="#b39c80" stroke-width="1.6" stroke-linecap="round"/></g>
    <ellipse cx="38" cy="85" rx="9" ry="6" fill="url(#${k}b)"/><ellipse cx="82" cy="85" rx="9" ry="6" fill="url(#${k}b)"/>
    <g stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">${eyes}${brows}${mouth}</g>
    <path d="M57.8 80.4 Q60 79.2 62.2 80.4 Q61.6 82.6 60 83 Q58.4 82.6 57.8 80.4Z" fill="#d9846f"/>
    <g class="pip-glasses" fill="none" stroke-linecap="round">
      <circle cx="47" cy="73.5" r="12" fill="#ffffff" fill-opacity=".12" stroke="#b08a52" stroke-width="2.6"/>
      <circle cx="73" cy="73.5" r="12" fill="#ffffff" fill-opacity=".12" stroke="#b08a52" stroke-width="2.6"/>
      <path d="M58.8 72 Q60 70.4 61.2 72" stroke="#b08a52" stroke-width="2.4"/>
      <path d="M35 71 L27 68" stroke="#b08a52" stroke-width="2.2"/><path d="M85 71 L93 68" stroke="#b08a52" stroke-width="2.2"/>
      <path d="M39.5 67 Q43 63.4 48 63.6" stroke="#fff" stroke-width="1.8" opacity=".7"/><path d="M65.5 67 Q69 63.4 74 63.6" stroke="#fff" stroke-width="1.8" opacity=".7"/>
    </g>
    ${paws}
    ${extra}
  </g>
</svg>`;
  }
  root.Pip = { svg };
})(typeof self !== 'undefined' ? self : this);
