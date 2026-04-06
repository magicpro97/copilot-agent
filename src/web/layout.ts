const cssStyles = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--bg4:#292e36;
  --border:#30363d;--border2:#3d444d;
  --text:#e6edf3;--text2:#8b949e;--text3:#484f58;
  --cyan:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--purple:#bc8cff;--orange:#f0883e;
  --font-sans:'Inter',system-ui,sans-serif;
  --font-mono:'JetBrains Mono','SF Mono',monospace;
  --radius:8px;
}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.header{background:var(--bg2);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}
.header-left{display:flex;align-items:center;gap:10px}
.header-left h1{font-size:16px;font-weight:600}
.header-left h1 span{color:var(--cyan)}
.live-badge{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--green);background:rgba(63,185,80,.1);padding:3px 10px;border-radius:12px;font-weight:500}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.clock{font-family:var(--font-mono);font-size:13px;color:var(--text2)}
.container{max-width:1280px;margin:0 auto;padding:16px 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px}
.stat{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;transition:border-color .2s}
.stat:hover{border-color:var(--border2)}
.stat-label{font-size:11px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.4px}
.stat-value{font-size:22px;font-weight:700;font-family:var(--font-mono);margin-top:2px}
.stat-value.green{color:var(--green)}.stat-value.cyan{color:var(--cyan)}
.stat-value.yellow{color:var(--yellow)}.stat-value.purple{color:var(--purple)}
.procs{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.procs-header{padding:10px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.procs-body{padding:4px 0}
.proc{padding:6px 16px;display:flex;align-items:center;gap:10px;font-size:13px}
.proc-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.proc-pid{font-family:var(--font-mono);color:var(--cyan);font-weight:500;min-width:70px}
.proc-sid{color:var(--text2);font-family:var(--font-mono);font-size:12px}
.proc-cwd{color:var(--text3);font-size:12px}
.empty{padding:14px 16px;color:var(--text3);font-size:13px}
.main{display:grid;grid-template-columns:360px 1fr;gap:0;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;min-height:calc(100vh - 260px)}
.sidebar{border-right:1px solid var(--border);overflow-y:auto}
.sidebar-header{padding:10px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;position:sticky;top:0;background:var(--bg2);z-index:2}
.count{background:var(--bg3);color:var(--text2);font-size:11px;padding:1px 7px;border-radius:10px;font-weight:500}
.s-item{padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}
.s-item:last-child{border-bottom:none}
.s-item:hover{background:var(--bg3)}
.s-item.active{background:rgba(88,166,255,.06);border-left:3px solid var(--cyan);padding-left:13px}
.s-row{display:flex;align-items:center;gap:10px}
.s-icon{font-size:14px;flex-shrink:0}
.s-info{flex:1;min-width:0}
.s-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-meta{font-size:11px;color:var(--text2);display:flex;gap:10px;margin-top:2px;flex-wrap:wrap}
.badge{font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;font-family:var(--font-mono);text-transform:uppercase}
.badge-done{background:rgba(63,185,80,.12);color:var(--green)}
.badge-stop{background:rgba(210,153,34,.12);color:var(--yellow)}
.badge-claude{background:rgba(217,119,6,.15);color:#f59e0b}
.badge-copilot{background:rgba(56,189,248,.12);color:#38bdf8}
.detail{padding:20px;overflow-y:auto}
.detail-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.detail-title{font-size:18px;font-weight:700}
.detail-id{font-family:var(--font-mono);font-size:11px;color:var(--text3);background:var(--bg);padding:3px 8px;border-radius:4px}
.detail-time{font-size:12px;color:var(--text2);margin-bottom:16px}
.detail-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:20px}
.d-stat{background:var(--bg);border-radius:6px;padding:10px}
.d-stat-label{font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.3px}
.d-stat-val{font-size:16px;font-weight:700;font-family:var(--font-mono);margin-top:1px}
.sub{margin-top:20px}
.sub-title{font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.tool-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px}
.tool-name{color:var(--text2);min-width:110px;text-align:right;font-family:var(--font-mono);font-size:11px}
.tool-bar-bg{flex:1;background:var(--bg);border-radius:3px;height:14px;overflow:hidden}
.tool-bar{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--cyan),var(--purple));opacity:.7;transition:width .4s ease}
.tool-count{font-family:var(--font-mono);color:var(--text2);min-width:40px;font-size:11px}
.commit-list,.task-list,.file-list,.error-list{list-style:none}
.commit-list li,.task-list li{padding:5px 0;font-size:13px;display:flex;align-items:flex-start;gap:6px;border-bottom:1px solid var(--border)}
.commit-list li:last-child,.task-list li:last-child{border-bottom:none}
.c-dot{color:var(--green);flex-shrink:0;margin-top:2px}
.t-check{color:var(--green);flex-shrink:0;margin-top:2px}
.file-list li{padding:2px 0;font-size:11px;font-family:var(--font-mono)}
.file-created{color:var(--green)}
.file-edited{color:var(--yellow)}
.error-list li{padding:5px 0;font-size:12px;color:var(--red)}
.more{font-size:11px;color:var(--text3);padding:4px 0}
.empty-detail{display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3)}
.diff-btn{background:var(--bg3);color:var(--cyan);border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;font-family:var(--font-sans);transition:all .15s}
.diff-btn:hover{background:var(--bg4);border-color:var(--cyan)}
.diff-view{padding:0}
.diff-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.diff-summary{font-size:12px;color:var(--text2)}
.diff-file{margin-bottom:16px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.diff-header{background:var(--bg3);padding:8px 14px;font-size:12px;font-family:var(--font-mono);font-weight:600;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)}
.diff-body{background:var(--bg);font-family:var(--font-mono);font-size:12px;line-height:1.6;overflow-x:auto;max-height:400px;overflow-y:auto}
.diff-add{background:rgba(63,185,80,.08);color:#7ee787;padding:0 14px;white-space:pre;border-left:3px solid var(--green)}
.diff-del{background:rgba(248,81,73,.08);color:#ffa198;padding:0 14px;white-space:pre;border-left:3px solid var(--red)}
.diff-more{padding:6px 14px;color:var(--text3);font-style:italic}
.diff-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--text3)}
.diff-empty-icon{font-size:32px}
.diff2html-wrapper{overflow-x:auto}
.diff2html-wrapper .d2h-wrapper{background:transparent}
.diff2html-wrapper .d2h-file-header{background:var(--bg3);border-color:var(--border);color:var(--text)}
.diff2html-wrapper .d2h-file-list-wrapper{background:var(--bg2);border-color:var(--border)}
.diff2html-wrapper .d2h-file-list-line{color:var(--text)}
.diff2html-wrapper .d2h-code-linenumber{background:var(--bg);color:var(--text3);border-color:var(--border)}
.diff2html-wrapper .d2h-code-line{background:var(--bg);color:var(--text)}
.diff2html-wrapper .d2h-code-side-line{background:var(--bg);color:var(--text)}
.diff2html-wrapper .d2h-del{background:rgba(248,81,73,.1);color:#ffa198}
.diff2html-wrapper .d2h-ins{background:rgba(63,185,80,.1);color:#7ee787}
.diff2html-wrapper .d2h-del .d2h-code-side-linenumber,.diff2html-wrapper .d2h-del .d2h-code-linenumber{background:rgba(248,81,73,.15);border-color:rgba(248,81,73,.2)}
.diff2html-wrapper .d2h-ins .d2h-code-side-linenumber,.diff2html-wrapper .d2h-ins .d2h-code-linenumber{background:rgba(63,185,80,.15);border-color:rgba(63,185,80,.2)}
.diff2html-wrapper .d2h-info{background:var(--bg3);color:var(--text2);border-color:var(--border)}
.diff2html-wrapper .d2h-emptyplaceholder{background:var(--bg3)}
.diff2html-wrapper .d2h-file-diff{border-color:var(--border)}
.diff2html-wrapper .d2h-diff-tbody tr td{border-color:var(--border)}
.diff2html-wrapper .d2h-tag{background:var(--bg3);color:var(--text2)}
@media(max-width:768px){.main{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
`;

export const layoutHead = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Copilot Agent Dashboard</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
<script src="https://unpkg.com/htmx.org@2.0.4" integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+" crossorigin="anonymous"></script>
<script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${cssStyles}
</style>
</head>`;

export const layoutFoot = `</html>`;
