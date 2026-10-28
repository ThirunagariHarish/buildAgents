// Speak instead of type. Uses the browser's own speech recognition when it
// has one (live words as you talk); otherwise, or when the phone refuses it,
// records and sends 16 kHz audio to our server's speech model.
//   Voice.configure({ server: true })   // the server can transcribe
//   Voice.supported()                   // show a mic at all?
//   Voice.start({ onText(text, final), onState('listening'|'thinking'|'idle'), onError(msg) }) -> stop()
(function (root) {
  'use strict';
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && root.MediaRecorder);
  let server = false, liveBroken = false;
  const BLOCKED = 'Microphone access is blocked for Jot. Allow it in your browser or phone settings.';

  function withBrowser(h) {
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '', stopped = false, heard = false, handedOff = null;
    rec.onresult = (e) => {
      heard = true;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      h.onText((finalText + interim).trim(), false);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // Some phones (home-screen apps on iPhone) refuse live dictation: record instead.
      if ((e.error === 'service-not-allowed' || e.error === 'network' || e.error === 'language-not-supported') && !heard && server && canRecord) {
        liveBroken = true; stopped = true; handedOff = withRecorder(h); return;
      }
      h.onError(e.error === 'not-allowed' ? BLOCKED : `Speech error: ${e.error}`);
    };
    rec.onend = () => { if (!stopped) { stopped = true; h.onState('idle'); h.onText(finalText.trim(), true); } };
    try { rec.start(); } catch (e) { if (server && canRecord) { liveBroken = true; return withRecorder(h); } h.onError(e.message); return () => {}; }
    h.onState('listening');
    return () => { if (handedOff) return handedOff(); if (!stopped) rec.stop(); };
  }

  /** Decode, mix to mono and resample to 16 kHz 16-bit PCM. */
  async function toPcm16k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (root.AudioContext || root.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf);
    ctx.close();
    const len = Math.ceil(audio.duration * 16000);
    const off = new OfflineAudioContext(1, Math.max(1, len), 16000);
    const src = off.createBufferSource();
    src.buffer = audio; src.connect(off.destination); src.start();
    const out = (await off.startRendering()).getChannelData(0);
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-1, Math.min(1, out[i])) * 0x7fff;
    return pcm.buffer;
  }
  function withRecorder(h) {
    let stopFn = () => {}, stopped = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mr = new MediaRecorder(stream);
      const chunks = [];
      const limit = setTimeout(() => stopFn(), 70000);
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        clearTimeout(limit);
        stream.getTracks().forEach((t) => t.stop());
        h.onState('thinking');
        try {
          const pcm = await toPcm16k(new Blob(chunks, { type: mr.mimeType }));
          const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm, credentials: 'same-origin' });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Could not turn that into text.');
          if (!j.text) throw new Error("Didn't catch that. Try again a little closer to the mic.");
          h.onText(j.text, true);
        } catch (e) { h.onError(e.message); }
        h.onState('idle');
      };
      mr.start();
      h.onState('listening');
      stopFn = () => { if (!stopped) { stopped = true; mr.stop(); } };
    }).catch(() => { h.onError(BLOCKED); h.onState('idle'); });
    return () => stopFn();
  }

  root.Voice = {
    configure(o) { server = !!(o && o.server); },
    supported: () => !!SR || (canRecord && server),
    live: () => !!SR && !liveBroken,
    start: (h) => (SR && !liveBroken ? withBrowser(h) : withRecorder(h)),
  };
})(window);
