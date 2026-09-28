// GFM pipe tables for the bundled lib/markdown.js, which has none. Used by
// llm-response.html and chat.html: renderWithTables(text, render) renders
// each table itself and passes every other chunk to the page's own markdown
// `render`, so text without a table renders exactly as before.
(function () {
    var ROW = /^\s*\|.*\|\s*$/;
    var SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
    var FENCE = /^\s*(```|~~~)/;

    function cells(line) {
        return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
    }

    function inline(render, text) {
        return String(render(text) || '').trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    }

    function tableHtml(lines, render) {
        var head = cells(lines[0]);
        var html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
        head.forEach(function (c) { html += '<th>' + inline(render, c) + '</th>'; });
        html += '</tr></thead><tbody>';
        lines.slice(2).forEach(function (l) {
            var row = cells(l);
            html += '<tr>';
            for (var i = 0; i < head.length; i++) html += '<td>' + inline(render, row[i] || '') + '</td>';
            html += '</tr>';
        });
        return html + '</tbody></table></div>';
    }

    window.renderWithTables = function (text, render) {
        if (!text || text.indexOf('|') === -1) return render(text);
        var lines = String(text).split('\n');
        var out = '';
        var buf = [];
        var inFence = false;
        var found = false;
        var flush = function () { if (buf.length) { out += render(buf.join('\n')); buf = []; } };
        for (var i = 0; i < lines.length; i++) {
            if (FENCE.test(lines[i])) inFence = !inFence;
            if (!inFence && ROW.test(lines[i]) && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
                var j = i + 2;
                while (j < lines.length && ROW.test(lines[j])) j++;
                flush();
                out += tableHtml(lines.slice(i, j), render);
                found = true;
                i = j - 1;
                continue;
            }
            buf.push(lines[i]);
        }
        if (!found) return render(text);
        flush();
        return out;
    };
})();
