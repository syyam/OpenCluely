const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const logger = require('../core/logger').createServiceLogger('WHISPER-WORKER');

class WhisperWorkerService {
  constructor() {
    this.process = null;
    this.pythonPath = null;
    this.scriptPath = null;
    this.pending = new Map();
    this.sequence = 0;
    this.readyInfo = null;
    this.closing = false;
  }

  // GPU stays loaded for the whole app session once warmed — reloading the
  // model after every idle gap was costing several seconds per request (see
  // the idle-unload removal below). It's released only on app quit, via
  // close() (called from speechService.shutdown()).
  configure({ pythonPath, scriptPath }) {
    const changed = this.pythonPath !== pythonPath || this.scriptPath !== scriptPath;
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    if (changed) {
      this.close();
    }
  }

  isConfigured() {
    return Boolean(
      this.pythonPath &&
      this.scriptPath &&
      fs.existsSync(this.pythonPath) &&
      fs.existsSync(this.scriptPath)
    );
  }

  async transcribe(audioPath, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Persistent Whisper worker is not configured');
    }
    return this._request({
      action: 'transcribe',
      audio_path: audioPath,
      model: options.model || 'small',
      language: options.language || 'auto',
      model_dir: options.modelDir || null,
      device: options.device || 'auto',
      prompt: options.prompt || null
    });
  }

  async warmup(options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Persistent Whisper worker is not configured');
    }
    return this._request({
      action: 'warmup',
      model: options.model || 'small',
      model_dir: options.modelDir || null,
      device: options.device || 'auto'
    });
  }

  _ensureProcess() {
    if (this.process && !this.process.killed) {
      return;
    }

    this.readyInfo = null;
    this.closing = false;
    const child = spawn(this.pythonPath, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this._handleLine(line));

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        logger.debug('Worker stderr', { message: message.substring(0, 1000) });
      }
    });

    child.on('error', (error) => {
      logger.error('Whisper worker process error', { error: error.message });
      this._rejectAll(error);
    });

    child.on('close', (code) => {
      const error = new Error(`Whisper worker exited with code ${code}`);
      if (!this.closing && code !== 0) {
        logger.error(error.message);
      }
      this.process = null;
      this.readyInfo = null;
      if (!this.closing) {
        this._rejectAll(error);
      }
      this.closing = false;
    });
  }

  _handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      logger.warn('Ignoring non-JSON worker output', { line: line.substring(0, 500) });
      return;
    }

    if (message.event === 'ready') {
      this.readyInfo = message;
      logger.info('Persistent Whisper worker ready', message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.ok) {
      pending.resolve(message);
    } else {
      const error = new Error(message.error || 'Whisper worker request failed');
      error.workerTraceback = message.traceback;
      pending.reject(error);
    }
  }

  _request(payload, timeoutMs = 180000) {
    this._ensureProcess();
    const id = ++this.sequence;
    const request = { ...payload, id };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Whisper worker timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      this.process.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  _rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    if (this.process && !this.process.killed) {
      try {
        this.closing = true;
        this.process.kill();
      } catch (_) {
        // Ignore shutdown races.
      }
    }
    this.process = null;
    this.readyInfo = null;
    this._rejectAll(new Error('Whisper worker closed'));
  }
}

module.exports = WhisperWorkerService;
