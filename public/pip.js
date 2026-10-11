// Pip, the Pocket Box mascot: a little box with a lid that never quite
// closes, a sprout with a glowing bulb, and a lot of enthusiasm.
// Pip.svg(mood, size) returns inline SVG. Moods: hi (waving), happy,
// think, sleep, wow, idle. Animation lives in CSS (.pip ...).
(function (root) {
  'use strict';
  let n = 0;
  function svg(mood = 'idle', size = 96, { still = false } = {}) {
    const id = `pip${++n}`;
    const ink = '#2b2442';
    const eyes = {
      happy: `<path d="M39 66 Q46 58 53 66" /><path d="M67 66 Q74 58 81 66" />`,
      sleep: `<path d="M39 66 Q46 71 53 66" /><path d="M67 66 Q74 71 81 66" />`,
      wow: `<ellipse cx="46" cy="64" rx="7.5" ry="9.5" class="fill"/><ellipse cx="74" cy="64" rx="7.5" ry="9.5" class="fill"/><circle cx="48.6" cy="60.4" r="2.8" fill="#fff"/><circle cx="76.6" cy="60.4" r="2.8" fill="#fff"/>`,
      think: `<ellipse cx="47" cy="61" rx="6.4" ry="8.2" class="fill"/><ellipse cx="75" cy="61" rx="6.4" ry="8.2" class="fill"/><circle cx="49.5" cy="57" r="2.3" fill="#fff"/><circle cx="77.5" cy="57" r="2.3" fill="#fff"/>`,
    }[mood] || `<g class="pip-eyes"><ellipse cx="45" cy="65" rx="7.6" ry="9.6" class="fill"/><ellipse cx="75" cy="65" rx="7.6" ry="9.6" class="fill"/><circle cx="47.8" cy="61" r="3" fill="#fff"/><circle cx="77.8" cy="61" r="3" fill="#fff"/><circle cx="43" cy="69" r="1.3" fill="#fff" opacity=".8"/><circle cx="73" cy="69" r="1.3" fill="#fff" opacity=".8"/></g>`;
    const mouth = {
      happy: `<path d="M51 77 Q60 87 69 77 Q60 82 51 77Z" class="fill"/>`,
      hi: `<path d="M51 77 Q60 87 69 77 Q60 82 51 77Z" class="fill"/>`,
      sleep: `<ellipse cx="60" cy="79" rx="2.6" ry="2" class="fill"/>`,
      wow: `<ellipse cx="60" cy="80" rx="4.2" ry="5" class="fill"/>`,
      think: `<path d="M55 80 Q60 78 66 80" />`,
    }[mood] || `<path d="M53 77 Q60 84 67 77" />`;
    const extra = {
      hi: `<g class="pip-arm"><path d="M101 84 Q112 76 114 62" stroke="#c9a6f7" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="114.5" cy="59" r="6.8" fill="#d7b3f6"/></g>`,
      sleep: `<g class="pip-z" fill="#9b84f5" font-family="ui-rounded, system-ui, sans-serif" font-weight="800"><text x="96" y="24" font-size="15">z</text><text x="108" y="12" font-size="10">z</text></g>`,
      think: `<g class="pip-dots" fill="#9b84f5"><circle cx="98" cy="22" r="3.2"/><circle cx="107" cy="14" r="4"/><circle cx="116" cy="5" r="4.6"/></g>`,
      wow: `<g fill="#ffcf5c"><path d="M14 40 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3z"/><path d="M104 30 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2z"/></g>`,
    }[mood] || '';
    return `<svg class="pip pip-${mood}${still ? ' still' : ''}" width="${size}" height="${size}" viewBox="-2 -9 124 134" role="img" aria-label="Pip">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b8ff"/><stop offset=".55" stop-color="#e9b8f0"/><stop offset="1" stop-color="#ffc2c7"/></linearGradient>
    <linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a68fff"/><stop offset="1" stop-color="#f59ec2"/></linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6c9"/><stop offset=".5" stop-color="#ffd76a"/><stop offset="1" stop-color="#ffb84d"/></radialGradient>
  </defs>
  <ellipse cx="60" cy="118" rx="30" ry="4.5" fill="#2b2442" opacity=".09" class="pip-shadow"/>
  <g class="pip-body">
    <g class="pip-sprout" transform="rotate(-7 14 44)"><path d="M60 30 C60 22 60 18 60 13" stroke="#8f78f2" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M60 22 C66 16 72 17 74 20 C70 24 65 24 60 22Z" fill="#8fd6a8"/><circle cx="60" cy="10" r="6.2" fill="url(#${id}g)" class="pip-bulb"/></g>
    <rect x="16" y="38" width="88" height="74" rx="30" fill="url(#${id}b)"/>
    <ellipse cx="40" cy="52" rx="14" ry="7" fill="#fff" opacity=".35" transform="rotate(-18 40 52)"/>
    <g class="pip-lid" transform="rotate(-7 14 44)"><rect x="10" y="27" width="100" height="21" rx="10.5" fill="url(#${id}l)"/><rect x="18" y="30.5" width="42" height="5" rx="2.5" fill="#fff" opacity=".4"/></g>
    <g class="pip-pocket"><path d="M47 92 h26 v9 a8 8 0 0 1 -8 8 h-10 a8 8 0 0 1 -8 -8z" fill="#fff" opacity=".42"/><path d="M47 92 h26" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/><path d="M60 104.5 c-3.4 -2.4 -5.2 -4 -5.2 -6 a2.6 2.6 0 0 1 5.2 -0.6 a2.6 2.6 0 0 1 5.2 0.6 c0 2 -1.8 3.6 -5.2 6z" fill="#ff7aa2"/></g>
    <g stroke="${ink}" stroke-width="3.2" stroke-linecap="round" fill="none">${eyes}${mouth}</g>
    <ellipse cx="33" cy="79" rx="7.5" ry="4.6" fill="#ff6f9c" opacity=".5"/><ellipse cx="87" cy="79" rx="7.5" ry="4.6" fill="#ff6f9c" opacity=".5"/>
    <ellipse cx="44" cy="112" rx="9" ry="4.6" fill="#a68fff"/><ellipse cx="76" cy="112" rx="9" ry="4.6" fill="#a68fff"/>
    ${extra}
  </g>
  <style>.pip .fill{fill:${ink};stroke:none}</style>
</svg>`;
  }
  root.Pip = { svg };
})(typeof self !== 'undefined' ? self : this);
