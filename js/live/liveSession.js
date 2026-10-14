// اتصال WebSocket بجلسة Gemini Live — مقابل LiveSession.kt
import * as Log from '../services/debugLog.js';
import { buildSetup } from '../core/liveConfig.js';
import { respond } from '../core/liveTools.js';

const URL_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const decoder = new TextDecoder();

function b64ToInt16(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer, 0, u8.length >> 1);
}
function int16ToB64(pcm) {
  const u8 = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export class LiveSession {
  constructor({ tools = true, apiKey, model, systemPrompt, voice, resumeHandle, languages = [], listener }) {
    Object.assign(this, { tools, apiKey, model, systemPrompt, voice, resumeHandle, languages, listener });
    this.ready = false; this.wasReadyOnce = false; this.closedByUs = false; this.finished = false;
  }
  ms() { return Math.round(performance.now() - this.t0); }

  connect() {
    this.t0 = performance.now();
    Log.d('LIVE', `اتصال… النموذج=${this.model} الصوت=${this.voice} استئناف=${!!this.resumeHandle} أداة الحساب=${this.tools}`);
    let ws;
    try { ws = this.ws = new WebSocket(`${URL_BASE}?key=${encodeURIComponent(this.apiKey)}`); }
    catch (err) { Log.e('LIVE', 'تعذّر فتح الاتصال', err); setTimeout(() => this.finish(-1, 'failed to connect'), 0); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => Log.guard('LIVE', () => {
      Log.d('LIVE', `WebSocket مفتوح بعد ${this.ms()}ms — إرسال setup`);
      ws.send(JSON.stringify(buildSetup(this.model, this.systemPrompt, this.voice, this.resumeHandle, this.languages, this.tools)));
    });
    ws.onmessage = (ev) => Log.guard('LIVE', () => this.handle(typeof ev.data === 'string' ? ev.data : decoder.decode(ev.data)));
    ws.onerror = () => Log.d('LIVE', `خطأ في الاتصال بعد ${this.ms()}ms`);
    ws.onclose = (ev) => Log.guard('LIVE', () => {
      Log.d('LIVE', `الخادم يغلق: code=${ev.code} سبب="${ev.reason}" بعد ${this.ms()}ms`);
      this.finish(ev.code, ev.reason || (ev.code === 1006 ? 'network' : ''));
    });
  }

  finish(code, reason) {
    if (this.finished) return;
    this.finished = true; this.ready = false;
    Log.d('LIVE', `انتهت الجلسة: code=${code} سبب="${reason}" كانت جاهزة=${this.wasReadyOnce} منّا=${this.closedByUs}`);
    if (!this.closedByUs) this.listener.onClosed(code, reason, this.wasReadyOnce);
  }

  handle(raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const L = this.listener;
    if (msg.setupComplete) {
      Log.d('LIVE', `✅ الجلسة جاهزة (setupComplete) بعد ${this.ms()}ms`);
      this.ready = true; this.wasReadyOnce = true; L.onReady();
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) L.onInterrupted();
      for (const part of sc.modelTurn?.parts || []) {
        const d = part.inlineData;
        if (d?.data) {
          const rate = Number(/rate=(\d+)/.exec(d.mimeType || '')?.[1]) || 24000;
          L.onAudio(b64ToInt16(d.data), rate);
        }
      }
      if (sc.outputTranscription?.text) L.onOutputText(sc.outputTranscription.text);
      if (sc.inputTranscription?.text) L.onInputText(sc.inputTranscription.text);
      if (sc.generationComplete) L.onGenerationComplete();
      if (sc.turnComplete) L.onTurnComplete();
    }
    if (msg.toolCall) {
      const response = respond(msg.toolCall);
      response.toolResponse.functionResponses.forEach((r, k) => {
        const expr = msg.toolCall.functionCalls?.[k]?.args?.expression ?? '';
        Log.d('CALC', `🧮 ${r.name}(${expr}) → ${JSON.stringify(r.response)}`);
      });
      this.ws?.send(JSON.stringify(response));
    }
    const u = msg.sessionResumptionUpdate;
    if (u?.newHandle && u.resumable !== false) L.onResumeHandle(u.newHandle);
    if (msg.goAway) { Log.d('LIVE', `goAway: ${JSON.stringify(msg.goAway)}`); L.onGoAway(); }
    const known = ['setupComplete', 'serverContent', 'sessionResumptionUpdate', 'goAway', 'usageMetadata', 'voiceActivity', 'toolCall', 'toolCallCancellation'];
    const unknown = Object.keys(msg).filter((k) => !known.includes(k));
    if (unknown.length) Log.d('LIVE', `رسالة أخرى [${unknown}]: ${raw.slice(0, 300)}`);
  }

  sendAudio(pcm16k) {
    if (!this.ready || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: int16ToB64(pcm16k), mimeType: 'audio/pcm;rate=16000' } } }));
  }

  sendText(text) {
    Log.d('LIVE', `إرسال نص (جاهز=${this.ready}): ${text.slice(0, 120)}`);
    if (!this.ready) return;
    this.ws.send(JSON.stringify({ realtimeInput: { text } }));
  }

  close() {
    Log.d('LIVE', 'إغلاق الجلسة من الصفحة');
    this.closedByUs = true; this.ready = false;
    try { this.ws?.close(1000, 'bye'); } catch {}
  }
}
