// رسالة الإعداد الأولى لجلسة Gemini Live — مطابقة لـ LiveConfig.kt
import { declarations } from './liveTools.js';

/** مهلة الصمت: يعطي الطفل وقتًا للتفكير والتردد قبل أن يعتبر كلامه انتهى */
export const SILENCE_MS = 1700;
export const PREFIX_PADDING_MS = 300;
export const ARABIC = ['ar'];
export const ARABIC_ENGLISH = ['ar', 'en'];

export function buildSetup(model, systemPrompt, voice, resumeHandle, languages = [], tools = true) {
  const setup = {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      // 0.4: دقة أعلى وارتجال أقل
      temperature: 0.4,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: systemPrompt }] },
    realtimeInputConfig: {
      automaticActivityDetection: {
        // HIGH: يلتقط بداية كلام الطفل فورًا (LOW كان يقطع أول المقاطع)
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        prefixPaddingMs: PREFIX_PADDING_MS,
        silenceDurationMs: SILENCE_MS,
      },
    },
    // لغة الطفل: العربية فقط (والإنجليزية في درس الإنجليزي)
    inputAudioTranscription: languages.length ? { languageCodes: [...languages] } : {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
  };
  // حاسبة داخل الصفحة يستدعيها Gemini (codeExecution رفضها gemini-3.8-live)
  if (tools) setup.tools = declarations();
  return { setup };
}
