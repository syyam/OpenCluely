// System design diagrams in the REAL renderer: loads llm-response.html in a
// hidden Electron window (real preload, real mermaid.min.js), then
//   1. draws every *.mmd file in the given folders with the overlay's own
//      drawMermaid (parse → render, with its label repair) and reports which
//      ones draw, which needed the repair and which fail;
//   2. shows each design answer (*.md next to a .mmd) in the overlay and saves
//      a screenshot per window size, so the diagram's fit can be checked.
// No API calls. Run (Electron, not node):
//   node_modules/electron/dist/electron.exe scripts/sd-render-check.js <outDir> <folder> [<folder> …]
// The folders are the eval output (scripts/eval-system-design.js).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const [outDir, ...folders] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SIZES = [[840, 480], [1100, 720]];

function answerOf(mdFile) {
  // eval files: "Q: …\n\n<answer>\n\n---\nREQ lines: …"
  const text = fs.readFileSync(mdFile, 'utf8');
  const body = text.replace(/^Q:[^\n]*\n\n/, '').replace(/\n---\nREQ lines:[\s\S]*$/, '');
  return body.trim();
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: SIZES[0][0],
    height: SIZES[0][1],
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'llm-response.html'));
  await new Promise(r => setTimeout(r, 500));

  const files = folders.flatMap(dir => fs.readdirSync(dir).filter(f => f.endsWith('.mmd')).map(f => path.join(dir, f)));
  const results = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const started = Date.now();
    const r = await win.webContents.executeJavaScript(`(async () => {
      const src = ${JSON.stringify(src)};
      try {
        const m = await ensureMermaid();
        let direct = true;
        try { await m.parse(diagramSource(src)); } catch (_) { direct = false; }
        const svg = await drawMermaid(src);
        return { ok: true, direct, svgLength: svg.length };
      } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 300) }; }
    })()`);
    results.push({ file: path.relative(path.dirname(path.dirname(file)), file), ms: Date.now() - started, ...r });
  }
  results.forEach(r => console.log(`${r.ok ? (r.direct ? 'OK      ' : 'REPAIRED') : 'FAIL    '} ${r.file} ${r.ms}ms${r.error ? ' — ' + r.error : ''}`));
  const ok = results.filter(r => r.ok).length;
  console.log(`\n${ok}/${results.length} diagrams drawn (${results.filter(r => r.ok && r.direct).length} without repair)`);

  // Screenshots of each design answer in the overlay: one per diagram in it
  // (eval files: <skill>-<step>.md with <skill>-<step>-<k>.mmd, or the older
  // one-diagram <skill>-<step>.mmd).
  let n = 0;
  const answers = [...new Set(files.map(f => f.replace(/(-\d+)?\.mmd$/, '.md')))].filter(f => fs.existsSync(f));
  for (const md of answers) {
    const content = answerOf(md);
    for (const [w, h] of SIZES) {
      win.setSize(w, h);
      n += 1;
      const id = `shot-${n}`;
      win.webContents.send('display-llm-response', { content, metadata: { skill: 'fullstack', usedFallback: false, messageId: id } });
      await new Promise(r => setTimeout(r, 1800));
      const count = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-message-id="${id}"] .diagram-block').length`);
      for (let k = 0; k < count; k++) {
        await win.webContents.executeJavaScript(`(() => {
          const b = document.querySelectorAll('[data-message-id="${id}"] .diagram-block')[${k}];
          const row = b && b.closest('.entry-body');
          (row || b).scrollIntoView({ block: 'start' });
        })()`);
        await new Promise(r => setTimeout(r, 400));
        const img = await win.webContents.capturePage();
        const name = `${path.basename(path.dirname(md))}-${path.basename(md, '.md')}-d${k + 1}-${w}x${h}.png`;
        fs.writeFileSync(path.join(outDir, name), img.toPNG());
      }
    }
  }
  // Expanded view of the last one.
  await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.diagram-block')].pop(); if (b) b.querySelector('[data-act="expand"]').click(); })()`);
  await new Promise(r => setTimeout(r, 600));
  fs.writeFileSync(path.join(outDir, 'expanded.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`Screenshots in ${outDir}`);
  app.quit();
});
