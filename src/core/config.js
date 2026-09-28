const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.appDataDir = path.join(os.homedir(), '.OpenCluely');
    this.loadConfiguration();
  }

  loadConfiguration() {
    this.config = {
      app: {
        name: 'OpenCluely',
        version: '1.0.0',
        processTitle: 'OpenCluely',
        dataDir: this.appDataDir,
        isDevelopment: this.env === 'development',
        isProduction: this.env === 'production'
      },
      
      window: {
        defaultWidth: 400,
        defaultHeight: 600,
        minWidth: 300,
        minHeight: 400,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../../preload.js')
        }
      },

      ocr: {
        language: 'eng',
        tempDir: os.tmpdir(),
        cleanupDelay: 5000
      },

      llm: {
        gemini: {
          model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
          // gemini-2.5-flash-lite was retired (404 "no longer available to
          // new users" as of 2026-09) — Google's own error message points
          // at gemini-3.5-flash-lite as the replacement. A dead model in
          // this list used to burn the full retry budget (~13s of backoff)
          // on every request before falling through to the next one.
          // Order from a 2026-09-25 head-to-head on the real interview prompt:
          // 3.5-flash-lite started streaming in ~1s every run while
          // 3.1-flash-lite took 1.6-8s and 503'd often under load, and
          // 3.5-flash was mostly 503. The primary is skipped here if listed.
          // 3rd slot (2026-09-28): gemini-3.5-flash was dropped — free tier
          // only 20 RPD (exceeded), slow when it answered. The preview shares
          // 3.1-flash-lite's quota (same row in AI Studio, 15 RPM / 500 RPD)
          // but not its serving capacity, so it still helps on 503s; on a
          // quota 429 it fails fast. Tested with the real voice prompt: first
          // chunk 4.7-5.9s. Not usable: 2.5-flash-lite (404, retired), Gemma 4
          // (16K TPM free, rejects thinkingBudget, emits its reasoning).
          fallbackModels: ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'],
          maxRetries: 3,
          timeout: 30000,
          // A streamed attempt that sends nothing at all within this long is
          // treated as stalled: it's dropped and the SAME request moves on to
          // the next model in fallbackModels (the next request starts from the
          // primary model again). Without it one stalled attempt waited the
          // full 30s timeout and used up requestBudgetMs, so no fallback model
          // was tried (2026-09-26 15:50). Doubled for "Optimized solution",
          // which thinks before its first token.
          firstChunkTimeoutMs: 8000,
          // Total time budget (ms) per user request across streaming, HTTPS
          // and SDK fallbacks: no new attempt/retry starts after it (an
          // attempt already running is not cut off).
          requestBudgetMs: 12000,
          // "Optimized solution" and "Deep reasoning" only — normal answers
          // keep the model above with thinkingBudget 0 / 'minimal' for speed.
          // Streamed deep-review prompt, medium thinking, 2026-09-27:
          // 3.6-flash first chunk 6-7s / done 8-11s; 3.1-flash-lite 2.6-3s /
          // ~10s. Rejected: 3.7-flash (5/5 HTTP 503), 3.8-flash (503
          // mid-stream), 3.5-flash and 3-flash-preview (17-26s to first chunk).
          // 3.5-flash-lite is the first backup (2026-09-28, Optimized on a
          // Vue answer): it kept the given watch+timer structure where
          // 3.1-flash-lite rewrote it around a custom debounce(). Free tier:
          // 3.6-flash 20 RPD; the lite models 500 RPD each.
          reasoning: {
            models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
            thinkingLevel: 'medium',
            maxOutputTokens: 8192,
            // Stalled model → next model. The primary (3.6-flash) thinks
            // 6-15s before its first text; the lite backups start in 3-6s
            // at medium (2026-09-28), so a silent backup is dropped sooner —
            // with 20s for every model, a silent 3.5-flash-lite made a Deep
            // reasoning answer start after ~23s instead of ~13s (live test).
            firstChunkTimeoutMs: 20000,
            backupFirstChunkTimeoutMs: 10000,
            // Socket/request timeout; the normal path keeps `timeout` below.
            timeoutMs: 60000,
            requestBudgetMs: 60000
          },
          fallbackEnabled: true,
          enableFallbackMethod: true,
          generation: {
            temperature: 0.7,
            topK: 32,
            topP: 0.9,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 }
          }
        }
      },

      speech: {
        provider: 'azure',
        azure: {
          language: 'en-US',
          enableDictation: true,
          enableAudioLogging: false,
          outputFormat: 'detailed'
        },
        whisper: {
          model: 'small',
          language: 'auto',
          // segmentMs is the legacy fixed-window size and now acts as the
          // hard upper bound for a single utterance when VAD is enabled.
          segmentMs: 4000,
          // Voice-activity-detection driven segmentation. Instead of cutting
          // audio on a blind timer (which splits sentences mid-word), we flush
          // a segment when the speaker pauses. This makes transcription align
          // with natural utterance boundaries.
          vadEnabled: true,
          // Trailing silence (ms) that ends an utterance and triggers a flush.
          silenceHangoverMs: 700,
          // Minimum accumulated speech (ms) before a pause counts as an
          // utterance — guards against coughs/clicks producing empty flushes.
          minUtteranceMs: 350,
          // Hard cap (ms): force-flush a long monologue even without a pause.
          maxUtteranceMs: 15000,
          // Pre-roll (ms) of audio kept before speech onset so the first
          // syllable isn't clipped when we start capturing.
          preRollMs: 300,
          // Absolute RMS energy floor (normalized 0..1). Energy below this is
          // always treated as silence regardless of the adaptive noise floor.
          vadEnergyFloor: 0.008
        }
      },

      session: {
        maxMemorySize: 1000,
        compressionThreshold: 500,
        clearOnRestart: false
      },

      stealth: {
        hideFromDock: true,
        noAttachConsole: true,
        disguiseProcess: true
      }
    };
  }

  get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, this.config);
    target[lastKey] = value;
  }

  getApiKey(service) {
    const envKey = `${service.toUpperCase()}_API_KEY`;
    return process.env[envKey];
  }

  isFeatureEnabled(feature) {
    return this.get(`features.${feature}`) !== false;
  }
}

module.exports = new ConfigManager();
