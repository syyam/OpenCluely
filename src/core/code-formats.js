// Code-format conversions offered under a finished answer ("Options API +
// CDN", "React JSX", ...). The format an answer is in is read from its own
// code blocks, so the buttons follow what was actually produced — the
// framework setting, a framework the question named, or a format the
// interviewer asked for — and the current format is never offered again.
// Answers without web-framework code (DSA, plain functions) get no buttons.
//
// Which format is the DEFAULT for a framework is prompt text and lives in
// framework.js getFrameworkDefaultsBlock; this file only converts.

const FORMATS = {
  // Vue 3
  'vue-composition-sfc': {
    family: 'vue3', label: 'Composition API + SFC', script: 'typed',
    describe: 'a Vue 3 single-file component (.vue) with the Composition API — `<script setup>` + `<template>` — fenced ```vue',
  },
  'vue-options-sfc': {
    family: 'vue3', label: 'Options API + SFC', script: 'typed',
    describe: 'a Vue 3 single-file component (.vue) with the Options API — `export default { data(), computed, watch, methods, lifecycle hooks }` (wrapped in `defineComponent` when the script is TypeScript) + `<template>` — fenced ```vue',
  },
  'vue-composition-cdn': {
    family: 'vue3', label: 'Composition API + CDN', script: 'browser',
    describe: 'one complete HTML page that loads Vue 3 from a CDN (`https://unpkg.com/vue@3/dist/vue.global.js`), with the template inside the `#app` element and `Vue.createApp({ setup() { …; return { … } } }).mount(\'#app\')` using `Vue.ref`/`Vue.computed`/`Vue.watch` — fenced ```html',
  },
  'vue-options-cdn': {
    family: 'vue3', label: 'Options API + CDN', script: 'browser',
    describe: 'one complete HTML page that loads Vue 3 from a CDN (`https://unpkg.com/vue@3/dist/vue.global.js`), with the template inside the `#app` element and `Vue.createApp({ data(), computed, watch, methods }).mount(\'#app\')` — fenced ```html',
  },
  // Vue 2
  'vue2-options-sfc': {
    family: 'vue2', label: 'Vue 2 Options API + SFC', script: 'javascript',
    describe: 'a Vue 2 single-file component (.vue) with the Options API — `export default { data(), computed, watch, methods, lifecycle hooks }` + a `<template>` with a single root element — fenced ```vue',
  },
  'vue2-options-cdn': {
    family: 'vue2', label: 'Vue 2 Options API + CDN', script: 'browser',
    describe: 'one complete HTML page that loads Vue 2 from a CDN (`https://unpkg.com/vue@2/dist/vue.js`), with the template inside the `#app` element and `new Vue({ el: \'#app\', data, computed, watch, methods })` — fenced ```html',
  },
  'vue2-composition-sfc': {
    family: 'vue2', label: 'Vue 2.7 Composition API + SFC', script: 'javascript',
    describe: 'a Vue 2.7 single-file component (.vue) with the Composition API — `<script setup>` importing `ref`/`computed`/`watch` from \'vue\' + a `<template>` with a single root element — fenced ```vue',
  },
  // React
  'react-tsx': {
    family: 'react', label: 'React TSX', script: 'typescript',
    describe: 'a React function component with hooks in TypeScript (.tsx) — fenced ```tsx',
  },
  'react-jsx': {
    family: 'react', label: 'React JSX', script: 'javascript',
    describe: 'a React function component with hooks in plain JavaScript (.jsx), no type annotations — fenced ```jsx',
  },
  'react-cdn': {
    family: 'react', label: 'React + CDN (HTML)', script: 'browser',
    describe: 'one complete HTML page that loads React 18 and ReactDOM (UMD builds) and `@babel/standalone` from a CDN, with the component in a `<script type="text/babel">` block rendered via `ReactDOM.createRoot(…).render(…)` — fenced ```html',
  },
  'react-class': {
    family: 'react', label: 'React class component', script: 'typed',
    describe: 'a React class component (`class … extends React.Component`) with `this.state`/`this.setState` and lifecycle methods (`componentDidMount`, `componentDidUpdate`, `componentWillUnmount`) in place of the hooks — fenced ```tsx when the script is TypeScript, otherwise ```jsx',
  },
};

// Frameworks whose answers never get conversions (their code shares React/Vue
// signals, but a CDN/class rewrite of a Next/Nuxt/React Native app makes no sense).
const NO_CONVERSION_FRAMEWORKS = new Set(['nextjs', 'nuxt', 'react-native']);

function codeOf(answer) {
  const blocks = [];
  const re = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(answer || '')))) blocks.push({ tag: m[1].toLowerCase(), code: m[2] });
  return blocks;
}

// Fences that hold diagrams / traces rather than solution code.
const NON_CODE_TAGS = new Set(['text', 'plaintext', 'txt']);

/**
 * An answer's solution code only — its real code blocks re-fenced, prose and
 * ```text diagrams/example flows dropped. With afterHeading, only the code
 * after the first "##/###/#### <afterHeading>…" heading (e.g. a Deep
 * reasoning answer's "### Improved —" section). '' when there is none.
 */
function solutionCode(answer, { afterHeading = null } = {}) {
  let text = String(answer || '');
  if (afterHeading) {
    const m = new RegExp(`^\\s{0,3}#{2,4}\\s+[*_\\s]*${afterHeading}\\b.*$`, 'im').exec(text);
    if (!m) return '';
    text = text.slice(m.index + m[0].length);
  }
  return codeOf(text)
    .filter(b => !NON_CODE_TAGS.has(b.tag))
    .map(b => '```' + b.tag + '\n' + b.code.replace(/\s+$/, '') + '\n```')
    .join('\n\n');
}

/**
 * The format an answer's code is in.
 * @returns {{family: string, current: string|null}|null} null = no web-framework code
 */
function detectFormat(answer, frameworkSetting) {
  if (NO_CONVERSION_FRAMEWORKS.has(frameworkSetting)) return null;
  const blocks = codeOf(answer);
  if (!blocks.length) return null;
  const code = blocks.map(b => b.code).join('\n');
  const tags = new Set(blocks.map(b => b.tag));
  if (/from\s+['"]react-native['"]/.test(code)) return null;

  const vueScore = [/<template[\s>]/, /<script[^>]*\bsetup\b/, /\bcreateApp\s*\(/, /\bnew Vue\s*\(/, /from\s+['"]vue['"]/, /\bv-(for|if|model|bind|on)\b/, /src=["'][^"']*\bvue(@[\d.]+)?\//]
    .filter(r => r.test(code)).length + (tags.has('vue') ? 2 : 0);
  const reactScore = [/from\s+['"]react['"]/, /\bReactDOM\b/, /\bReact\.Component\b/, /\buse(State|Effect|Memo|Callback|Ref|Reducer)\s*[<(]/, /\bclassName=/, /src=["'][^"']*\breact(-dom)?@/]
    .filter(r => r.test(code)).length + (tags.has('tsx') || tags.has('jsx') ? 2 : 0);
  if (!vueScore && !reactScore) return null;

  if (vueScore >= reactScore) {
    const vue2 = frameworkSetting === 'vue2' || /\bnew Vue\s*\(/.test(code) || /vue@2/.test(code);
    const cdn = /\bVue\.createApp\b|\bnew Vue\s*\(|=\s*Vue\s*;?\s*$/m.test(code) || /src=["'][^"']*\bvue(@[\d.]+)?\//.test(code);
    const composition = /<script[^>]*\bsetup\b/.test(code) || /\bsetup\s*\(/.test(code);
    const options = /\bdata\s*\(\s*\)\s*\{|\bdata\s*:\s*(function|\(|\{)|\b(methods|computed|watch)\s*:\s*\{/.test(code);
    const style = composition ? 'composition' : options ? 'options' : null;
    const family = vue2 ? 'vue2' : 'vue3';
    const id = style && `${vue2 ? 'vue2' : 'vue'}-${style}-${cdn ? 'cdn' : 'sfc'}`;
    return { family, current: FORMATS[id] ? id : null };
  }

  let current;
  if (/extends\s+(React\.)?(Pure)?Component\b/.test(code)) current = 'react-class';
  else if (/text\/babel/.test(code) || /src=["'][^"']*\breact(-dom)?@/.test(code)) current = 'react-cdn';
  else if (tags.has('tsx') || tags.has('typescript') || /useState<|:\s*React\.|\binterface\s+\w+|\btype\s+\w+\s*=|\):\s*\w/.test(code)) current = 'react-tsx';
  else current = 'react-jsx';
  return { family: 'react', current };
}

/** [{id, label}] offered as buttons under this answer ([] = none). */
function conversionOptions(answer, frameworkSetting) {
  const found = detectFormat(answer, frameworkSetting);
  if (!found) return [];
  return Object.entries(FORMATS)
    .filter(([id, f]) => f.family === found.family && id !== found.current)
    .map(([id, f]) => ({ id, label: f.label }));
}

function getFormat(id) {
  return FORMATS[id] || null;
}

function scriptLanguage(format, programmingLanguage) {
  const js = String(programmingLanguage || '').toLowerCase() === 'javascript';
  if (format.script === 'browser') return 'plain JavaScript (it runs in the browser without a build step)';
  if (format.script === 'javascript') return 'JavaScript';
  if (format.script === 'typescript') return 'TypeScript';
  return js ? 'JavaScript' : 'TypeScript (`lang="ts"` on a Vue `<script>`)';
}

/** System-prompt section for a "convert to <format>" request. */
function getConvertNote(id, programmingLanguage) {
  const f = FORMATS[id];
  if (!f) return '';
  return `

## Format Conversion Request (overrides the answer formats above for this message)
The conversation contains the original question and the solution already given. Rewrite that same solution as ${f.describe}.
- Port it, don't redesign it: same behavior, logic, names, edge cases and handling as the given solution; change only what this format requires (how state, lifecycle, imports, the template and mounting are written). No new features, state, mock data or optimizations.
- Script language: ${scriptLanguage(f, programmingLanguage)}.
- Use the same Coding answer format with the heading \`### Solution — ${f.label}\`. Understanding: one line saying this is the same solution as ${f.label}. Keep the same Approach steps, the same numbered \`(n)\` comments on the matching lines and the same Implementation points (reword one only where this format does it differently). No CHANGED markers.
- Complete code, not a diff.`;
}

module.exports = {
  FORMATS,
  detectFormat,
  conversionOptions,
  getFormat,
  getConvertNote,
  solutionCode,
};
