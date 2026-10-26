// Background health checks for both answer chains: the normal one (primary
// model + fallbackModels) and the reasoning one used by Deep reasoning /
// Optimized (llm.gemini.reasoning.models). A model that failed is skipped
// (src/core/model-health.js); when its skip ends it is NOT handed a real
// question to find out whether it recovered — this monitor sends a tiny probe
// instead and the model comes back only when that answers quickly. Both
// chains are also probed at startup and after a model change (normal chain
// first, so the first answer isn't delayed), so neither a first question nor
// a first Deep reasoning click has to find out that its primary is down.
const { EventEmitter } = require('events');
const logger = require('../core/logger').createServiceLogger('MODEL-MONITOR');
const config = require('../core/config');
const modelHealth = require('../core/model-health');

class ModelMonitor extends EventEmitter {
  constructor(llm) {
    super();
    this.llm = llm;
    this.timer = null;
    this.probing = new Set();
    this.retryAt = new Map(); // model → time before which it isn't re-probed (non-model failure)
    this.checked = new Map(); // model → { ok, ms, at } of its last probe
    this.unsubscribe = null;
    this.now = () => Date.now();
  }

  settings() {
    return config.get('llm.gemini.probe') || {};
  }

  /** The normal answer chain, in order. */
  chain() {
    return this.llm._modelsToTry();
  }

  /** The Deep reasoning / Optimized chain, in order. */
  reasoningChain() {
    return [...new Set(((config.get('llm.gemini.reasoning') || {}).models) || [])];
  }

  /** Every model either chain may use (all probe-managed). */
  allModels() {
    return [...new Set([...this.chain(), ...this.reasoningChain()])];
  }

  start() {
    if (this.timer) return;
    modelHealth.setProbeModels(this.allModels());
    this.unsubscribe = modelHealth.onChange(() => this.emitStatus());
    this.timer = setInterval(() => { this.tick(); }, this.settings().intervalMs || 10000);
    if (this.timer.unref) this.timer.unref();
    this.probeStartup();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  /** The primary model or its fallbacks changed (Settings). */
  refresh() {
    modelHealth.setProbeModels(this.allModels());
    this.emitStatus();
    return this.probeStartup();
  }

  /** Normal chain first (the next question needs it), then the reasoning chain. */
  async probeStartup() {
    const normal = await this.probeChain();
    const reasoning = await this.probeChain(this.reasoningChain());
    return { normal, reasoning };
  }

  /**
   * Startup / model change: probe down the chain until one model answers, so
   * the first question already goes to a model known to work. Models that are
   * skipped for a known reason (e.g. out of quota for the day) are left alone.
   */
  async probeChain(models = this.chain()) {
    if (!this.llm.isInitialized) {
      this.emitStatus();
      return null;
    }
    for (const model of models) {
      const skip = modelHealth.status(model);
      if (skip && !skip.awaitingProbe) continue;
      // Already answered a probe this run (the lite models are in both
      // chains) and not skipped since: no second request for the same news.
      const last = this.checked.get(model);
      if (last && last.ok && !skip) return model;
      const result = await this.probe(model);
      if (result && result.ok) return model;
    }
    return null;
  }

  /** Probe every model whose skip has ended. Called on an interval. */
  async tick() {
    if (!this.llm.isInitialized) return;
    // A question was answered since the last tick: refresh "last used".
    if (this.llm.lastModel !== this.lastSeenModel) {
      this.lastSeenModel = this.llm.lastModel;
      this.emitStatus();
    }
    const t = this.now();
    for (const model of modelHealth.dueForProbe()) {
      if (this.probing.has(model) || (this.retryAt.get(model) || 0) > t) continue;
      await this.probe(model);
    }
  }

  /** Probe one model now (also the "Try now" button). */
  async probe(model) {
    if (!model || this.probing.has(model)) return null;
    this.probing.add(model);
    this.emitStatus();
    let result;
    try {
      result = await this.llm.probeModel(model);
    } catch (error) {
      result = { ok: false, error: error.message, recorded: false };
    }
    this.probing.delete(model);
    this.checked.set(model, { ok: result.ok, ms: result.ms, at: this.now() });
    // A failure that says nothing about the model (offline, bad key…) isn't
    // recorded as a skip, so without this it would be re-probed every tick.
    if (!result.ok && !result.recorded) this.retryAt.set(model, this.now() + (this.settings().networkRetryMs || 60000));
    else this.retryAt.delete(model);
    this.emitStatus();
    return result;
  }

  /** What the status line shows. */
  status() {
    const chain = this.chain();
    const snapshot = modelHealth.snapshot();
    const skipped = snapshot.filter(s => chain.includes(s.model));
    const next = modelHealth.order(chain)[0] || null;
    const rChain = this.reasoningChain();
    const reasoning = rChain.length ? {
      primary: rChain[0],
      chain: rChain,
      next: modelHealth.order(rChain)[0] || null,
      skipped: snapshot.filter(s => rChain.includes(s.model)),
      primaryChecked: this.checked.get(rChain[0]) || null,
    } : null;
    return {
      reasoning,
      primary: chain[0] || null,
      chain,
      next,
      lastUsed: this.llm.lastModel || null,
      skipped,
      probing: [...this.probing],
      primaryChecked: this.checked.get(chain[0]) || null,
      now: this.now(),
    };
  }

  emitStatus() {
    this.emit('status', this.status());
  }
}

module.exports = { ModelMonitor };
