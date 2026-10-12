// Speak instead of type. Uses the browser's own speech recognition when it
// has one (Chrome, Safari, Edge: live words as you talk); otherwise records
// and sends 16 kHz audio to the server's Whisper model.
//   Voice.start({ onText(text, final), onState(state), onError(msg) }) -> stop()
(function (root) {
  'use strict';
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && root.MediaRecorder);
  const supported = !!SR || canRecord;

  function withBrowser({ onText, onState, onError }) {
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '', stopped = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      onText((finalText + interim).trim(), false);
    };
    rec.onerror = (e) => { if (e.error === 'no-speech' || e.error === 'aborted') return; onError(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser settings.' : `Speech error: ${e.error}`); };
    rec.onend = () => { if (!stopped) { stopped = true; onState('idle'); onText(finalText.trim(), true); } };
    rec.start();
    onState('listening');
    return () => { if (!stopped) rec.stop(); };
  }

  /** Decode, mix to mono and resample to 16 kHz 16-bit PCM for Whisper. */
  async function toPcm16k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (root.AudioContext || root.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf);
    ctx.close();
    const len = Math.ceil(audio.duration * 16000);
    const off = new OfflineAudioContext(1, len, 16000);
    const src = off.createBufferSource();
    src.buffer = audio; src.connect(off.destination); src.start();
    const out = (await off.startRendering()).getChannelData(0);
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-1, Math.min(1, out[i])) * 0x7fff;
    return pcm.buffer;
  }
  function withRecorder({ onText, onState, onError }) {
    let stopFn = () => {}, stopped = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mr = new MediaRecorder(stream);
      const chunks = [];
      const limit = setTimeout(() => stopFn(), 60000);
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        clearTimeout(limit);
        stream.getTracks().forEach((t) => t.stop());
        onState('thinking');
        try {
          const pcm = await toPcm16k(new Blob(chunks, { type: mr.mimeType }));
          const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm, credentials: 'same-origin' });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Transcription failed.');
          onText(j.text || '', true);
        } catch (e) { onError(e.message); }
        onState('idle');
      };
      mr.start();
      onState('listening');
      stopFn = () => { if (!stopped) { stopped = true; mr.stop(); } };
    }).catch(() => { onError('Microphone access was blocked. Allow it in your browser settings.'); onState('idle'); });
    return () => stopFn();
  }

  root.Voice = { supported, live: !!SR, start: (h) => (SR ? withBrowser(h) : withRecorder(h)) };
})(window);
