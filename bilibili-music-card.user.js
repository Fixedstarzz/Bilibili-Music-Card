// ==UserScript==
// @name         Bilibili 音乐卡片
// @name:en-US   Bilibili Music Card
// @namespace    bmc.local
// @version      1.0.0
// @description  把 B 站视频链接变成歌单：悬浮音乐卡片后台播放，扫码登录 B 站账号，随机/顺序/单曲循环、音量与进度调节、封面模糊背景；默认仅在 B 站相关页面运行，其他页面可从油猴菜单临时启用。
// @description:en-US Turn Bilibili video links into a playlist: a floating music card that plays audio in the background, with QR login, shuffle/sequence/loop, volume and seek controls, and a blurred-cover backdrop. Runs on Bilibili pages by default; other sites can be enabled temporarily from the userscript menu.
// @author       Fixedstarzz
// @license      MIT
// @icon         data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Crect%20width='24'%20height='24'%20rx='6'%20fill='%2316161c'/%3E%3Ccircle%20cx='9.5'%20cy='16'%20r='2.6'%20fill='%23fa2d48'/%3E%3Cpath%20d='M12.6%2016V7.4l5.2-1.2v2.6l-3.6.9V16z'%20fill='%23fff'/%3E%3C/svg%3E
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @connect      passport.bilibili.com
// @connect      passport.biligame.com
// @connect      b23.tv
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- GM 兜底桩（无油猴环境时用 localStorage，仅供本地调试 UI） ----------------
  if (typeof GM_getValue !== 'function') {
    const P = 'bmc.';
    window.GM_getValue = k => localStorage.getItem(P + k);
    window.GM_setValue = (k, v) => localStorage.setItem(P + k, typeof v === 'string' ? v : JSON.stringify(v));
    window.GM_deleteValue = k => localStorage.removeItem(P + k);
    window.GM_addValueChangeListener = (k, fn) => addEventListener('storage', e => {
      if (e.key === P + k && e.newValue != null) { let v = e.newValue; try { v = JSON.parse(v); } catch (x) {} fn(k, null, v, true); }
    });
    window.GM_xmlhttpRequest = o => {
      fetch(o.url).then(r => r.text().then(t => o.onload && o.onload({ status: r.status, responseText: t, finalUrl: r.url }))).catch(() => o.onerror && o.onerror());
    };
  }

  // ---------------- 常量 ----------------
  const K = { cfg: 'bmc.cfg', meta: 'bmc.meta', streams: 'bmc.streams', hb: 'bmc.hb', cmd: 'bmc.cmd', claim: 'bmc.claim', seen: 'bmc.seen', auth: 'bmc.auth', posmap: 'bmc.posmap', addedAt: 'bmc.addedAt' };
  const MYID = 'e' + Math.random().toString(36).slice(2, 10);
  const HB_MS = 2000;          // 引擎心跳
  const STALE_MS = 7000;       // 心跳过期阈值
  const STREAM_TTL = 25 * 60e3; // 音频直链缓存（CDN 链接本身有数小时有效期）

  const FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#3b3b47"/><stop offset="1" stop-color="#16161c"/></linearGradient></defs>' +
    '<rect width="200" height="200" fill="url(#g)"/>' +
    '<g fill="rgba(255,255,255,.28)"><circle cx="92" cy="144" r="15"/>' +
    '<rect x="103" y="58" width="7" height="88" rx="3.5"/>' +
    '<path d="M103 58c25 4 35 21 30 42-2-17-14-26-30-28z"/></g></svg>');

  const I = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10.2-6.5a1 1 0 0 0 0-1.68L9.54 4.66A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.4" height="14" rx="1.2"/><path d="M19.5 6.4v11.2a1 1 0 0 1-1.55.83l-8.4-5.6a1 1 0 0 1 0-1.66l8.4-5.6a1 1 0 0 1 1.55.83z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.6" y="5" width="2.4" height="14" rx="1.2"/><path d="M4.5 6.4v11.2a1 1 0 0 0 1.55.83l8.4-5.6a1 1 0 0 0 0-1.66l-8.4-5.6a1 1 0 0 0-1.55.83z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    seq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    one: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>',
    big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    dn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.3 4.6v14.8a.9.9 0 0 1-1.48.69L5.6 16.5H3.2a1.2 1.2 0 0 1-1.2-1.2V8.7a1.2 1.2 0 0 1 1.2-1.2h2.4l4.22-3.6a.9.9 0 0 1 1.48.7z"/><path d="M15.3 8.6a4.8 4.8 0 0 1 0 6.8M18.4 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    volMute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.3 4.6v14.8a.9.9 0 0 1-1.48.69L5.6 16.5H3.2a1.2 1.2 0 0 1-1.2-1.2V8.7a1.2 1.2 0 0 1 1.2-1.2h2.4l4.22-3.6a.9.9 0 0 1 1.48.7z"/><path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    cfg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------------- 工具 ----------------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // B 站 CDN 仅对空 Referer / B 站 Referer 放行，页面资产一律 https 化（跳过本地调试地址）
  const https = u => /^http:\/\//.test(u) && !/^http:\/\/(localhost|127\.)/.test(u) ? u.replace(/^http:/, 'https:') : u;

  // ---------------- 资源域白名单（防 API 返回的 URL 把流量/身份带向第三方） ----------------
  const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
  const isBiliImgHost = h => h === 'hdslb.com' || h.endsWith('.hdslb.com');
  const isStreamHost = h => ['bilivideo.com', 'bilivideo.cn', 'akamaized.net', 'hdslb.com'].some(d => h === d || h.endsWith('.' + d));
  // 封面/头像：https 归一化后仅允许 data: 或 *.hdslb.com，否则回退占位图
  // 注意：B 站接口返回的封面是 http:// 协议，必须先升级 https 再做域校验（v1.1.0 曾因直接拒收 http 导致封面失效）
  function safeImg(u) {
    if (!u) return FALLBACK;
    if (u.startsWith('data:image/')) return u;
    const s = https(u);
    return s.startsWith('https://') && isBiliImgHost(hostOf(s)) ? s : FALLBACK;
  }
  function safeFace(u) { const s = https(u || ''); return /^https:\/\//i.test(s) && isBiliImgHost(hostOf(s)) ? s : ''; }
  // 音频流：https 归一化后仅允许 B 站 CDN 域族（upos/mcdn/akamai），否则拒绝取流
  function safeStream(u) {
    if (!u) return '';
    const s = https(u);
    if (!/^https:\/\//i.test(s)) return s; // 相对路径仅测试台架使用
    return isStreamHost(hostOf(s)) ? s : '';
  }
  // 登录 crossDomain 回调：仅允许 https + B 站 passport 域
  function isLoginCallback(u) {
    if (!/^https:\/\//i.test(u)) return false;
    const h = hostOf(u);
    return h === 'passport.biligame.com' || h === 'passport.bilibili.com' || h.endsWith('.bilibili.com');
  }

  function parseId(u) {
    const bv = u.match(/BV[0-9A-Za-z]{10}/);
    const page = (u.match(/[?&]p=(\d+)/) || [])[1] | 0;
    if (bv) return { bvid: bv[0], page };
    const av = u.match(/av(\d+)/i);
    if (av) return { aid: av[1], page };
    return null;
  }

  const S = {
    get(k, d) { let v; try { v = GM_getValue(k); } catch (e) {} if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return v; } } return v; },
    set(k, v) { try { GM_setValue(k, v); } catch (e) {} },
    del(k) { try { GM_deleteValue(k); } catch (e) {} },
    onChange(k, fn) { if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(k, (key, ov, nv, remote) => fn(nv, remote)); }
  };

  function gmJSON(base, params, cb, opts) {
    const qs = Object.keys(params).map(x => x + '=' + encodeURIComponent(params[x])).join('&');
    const o = {
      method: 'GET', url: base + '?' + qs, timeout: 15000,
      onload: r => { let d = null; try { d = JSON.parse(r.responseText); } catch (e) {} if (!d) return cb(null, '响应解析失败'); cb(d, null); },
      onerror: () => cb(null, '网络错误'),
      ontimeout: () => cb(null, '请求超时')
    };
    const a = opts && opts.auth ? authGet() : null;
    if (a && a.sessdata) o.headers = { Cookie: 'SESSDATA=' + a.sessdata + '; bili_jct=' + a.biliJct + '; DedeUserID=' + a.dedeUserId };
    GM_xmlhttpRequest(o);
  }

  function authGet() { return S.get(K.auth, null); }

  function apiMsg(d) { return d && d.message ? 'B站: ' + d.message : '接口返回异常'; }

  // ---------------- 极简 QR 编码器（byte 模式 / EC 级 M / 版本 1-20，自包含零依赖） ----------------
  function qrEncode(text) {
    const bytes = new TextEncoder().encode(text);
    // v1-20 的 byte 字符容量（EC 级 M）与总码字数
    const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666];
    const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085];
    // RS 块结构（M 级）: [每块EC码字数, [块数, 每块数据码字, ...]]
    const BLK = [
      [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
      [16, [4, 27]], [18, [4, 31]], [22, [2, 38, 2, 39]], [22, [3, 36, 2, 37]], [26, [4, 43, 1, 44]],
      [30, [1, 50, 4, 51]], [22, [6, 36, 2, 37]], [22, [8, 37, 1, 38]], [26, [4, 40, 5, 41]], [24, [5, 41, 5, 42]],
      [28, [7, 45, 3, 46]], [28, [10, 46, 1, 47]], [26, [9, 43, 4, 44]], [26, [3, 44, 11, 45]], [28, [3, 41, 13, 42]]
    ];
    const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
      [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
    let ver = 0;
    for (let v = 1; v <= 20; v++) if (bytes.length <= CAP[v - 1]) { ver = v; break; }
    if (!ver) throw new Error('QR 内容过长');

    const [ecLen, groups] = BLK[ver - 1];
    let dataCw = 0;
    for (let g = 0; g < groups.length; g += 2) dataCw += groups[g] * groups[g + 1];

    // 数据比特流：模式 + 计数 + 数据 + 终止符 + 对齐 + 填充
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, dataCw * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; dataBytes.push(b); }
    const pads = [0xec, 0x11];
    let padI = 0;
    while (dataBytes.length < dataCw) dataBytes.push(pads[padI++ % 2]);

    // GF(256) + Reed-Solomon 纠错
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
    function rsGen(n) {
      let g = [1];
      for (let i = 0; i < n; i++) {
        const ng = new Array(g.length + 1).fill(0);
        for (let k = 0; k < g.length; k++) { ng[k] ^= g[k]; ng[k + 1] ^= gmul(g[k], EXP[i]); }
        g = ng;
      }
      return g;
    }
    function rsRem(data) {
      const gen = rsGen(ecLen);
      const res = data.concat(new Array(ecLen).fill(0));
      for (let i = 0; i < data.length; i++) {
        const c = res[i];
        if (c) for (let j = 1; j <= ecLen; j++) res[i + j] ^= gmul(gen[j], c);
      }
      return res.slice(data.length);
    }

    // 分块 + 交错
    const blocks = [];
    let off = 0;
    for (let g = 0; g < groups.length; g += 2) {
      const cnt = groups[g], dw = groups[g + 1];
      for (let b = 0; b < cnt; b++) { blocks.push(dataBytes.slice(off, off + dw)); off += dw; }
    }
    const ecs = blocks.map(rsRem);
    const final = [];
    const maxDw = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxDw; i++) for (const blk of blocks) if (i < blk.length) final.push(blk[i]);
    for (let i = 0; i < ecLen; i++) for (const ec of ecs) final.push(ec[i]);

    // 矩阵与功能图案
    const size = ver * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const R = Array.from({ length: size }, () => new Array(size).fill(false));
    const setR = (r, c, v) => { M[r][c] = v; R[r][c] = true; };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        setR(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { if (!R[6][i]) setR(6, i, i % 2 === 0); if (!R[i][6]) setR(i, 6, i % 2 === 0); }
    for (const r of ALIGN[ver - 1]) for (const c of ALIGN[ver - 1]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setR(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    // 预留 format / version / dark module 区域
    for (let i = 0; i < 15; i++) {
      const r1 = i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i); if (r1 < size) R[r1][8] = true;
      const c1 = i < 8 ? size - 1 - i : (i < 9 ? 7 : 14 - i); R[8][c1] = true;
    }
    R[size - 8][8] = true;
    if (ver >= 7) for (let i = 0; i < 18; i++) { R[Math.floor(i / 3)][size - 11 + (i % 3)] = true; R[size - 11 + (i % 3)][Math.floor(i / 3)] = true; }

    const flb = n => { let b = 0; while (n > 1) { n >>= 1; b++; } return b; };
    const bchFmt = d => { let r = d << 10; while (flb(r) >= 10) r ^= 0x537 << (flb(r) - 10); return ((d << 10) | r) ^ 0x5412; };
    const maskFn = [
      (r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
    ];
    const bitArr = [];
    for (const b of final) for (let i = 7; i >= 0; i--) bitArr.push((b >> i) & 1);

    // 数据放置（蛇形），返回应用指定掩码后的矩阵副本
    function build(maskId) {
      const m = M.map(row => row.slice());
      const mf = maskFn[maskId];
      let inc = -1, row = size - 1, bi = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!R[row][col - c]) {
              let dark = bi < bitArr.length ? bitArr[bi] === 1 : false;
              if (mf(row, col - c)) dark = !dark;
              m[row][col - c] = dark;
              bi++;
            }
          }
          row += inc;
          if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
      }
      return m;
    }
    function penalty(m) {
      let p = 0;
      for (let r = 0; r < size; r++) {
        let runH = 1, runV = 1;
        for (let c = 1; c < size; c++) {
          if (m[r][c] === m[r][c - 1]) { runH++; if (runH > 4) p += runH === 5 ? 3 : 1; } else runH = 1;
          if (m[c][r] === m[c - 1][r]) { runV++; if (runV > 4) p += runV === 5 ? 3 : 1; } else runV = 1;
        }
      }
      for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++)
        if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
      const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const seg = (get) => {
        for (let a = 0; a < size; a++) for (let b = 0; b <= size - 11; b++) {
          let ok1 = true, ok2 = true;
          for (let k = 0; k < 11; k++) {
            const v = get(a, b + k) ? 1 : 0;
            if (v !== P1[k]) ok1 = false;
            if (v !== P2[k]) ok2 = false;
            if (!ok1 && !ok2) break;
          }
          if (ok1 || ok2) p += 40;
        }
      };
      seg((a, b) => m[a][b]); seg((a, b) => m[b][a]);
      let dark = 0;
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
      p += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
      return p;
    }
    let best = 0, bestP = Infinity;
    for (let mk = 0; mk < 8; mk++) { const p = penalty(build(mk)); if (p < bestP) { bestP = p; best = mk; } }
    const out = build(best);

    // 写入 format / version / dark module
    const fmt = bchFmt(best);
    for (let i = 0; i < 15; i++) {
      const bit = (fmt >> i) & 1;
      const r1 = i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i); if (r1 < size) out[r1][8] = bit === 1;
      const c1 = i < 8 ? size - 1 - i : (i < 9 ? 7 : 14 - i); out[8][c1] = bit === 1;
    }
    out[size - 8][8] = true;
    if (ver >= 7) {
      let vr = ver << 12; while (flb(vr) >= 12) vr ^= 0x1f25 << (flb(vr) - 12);
      const vb = (ver << 12) | vr;
      for (let i = 0; i < 18; i++) {
        const bit = (vb >> i) & 1;
        out[Math.floor(i / 3)][size - 11 + (i % 3)] = bit === 1;
        out[size - 11 + (i % 3)][Math.floor(i / 3)] = bit === 1;
      }
    }
    return { size, modules: out };
  }
  // 测试钩子：仅在本地台架/单测显式开启时暴露（油猴环境必有 GM_info，正式安装中不可达）
  if (typeof globalThis !== 'undefined' && globalThis.__BMC_EXPORT_QR__ && typeof GM_info === 'undefined') globalThis.BMC_QR = { encode: qrEncode, root: () => rootRef, safeImg, safeStream, isBiliPage, openPanel: () => openPanel(), addUrls: list => addUrls(list), removeUrl: i => removeUrl(i), reorderUrl: (a, b) => reorderUrl(a, b), openBig: () => openBig(), clearAll: () => clearAll() };

  // ---------------- 登录凭证：本地缓存 + 过期检测 ----------------
  // SESSDATA 存于脚本存储；启动/打开面板时用 nav 接口校验，过期即清除并要求重新扫码
  const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
  const AUTH_TTL = 10 * 60e3; // 校验结果缓存时长
  let authCheckedAt = 0;
  let lastRefreshProbe = 0;    // 临期续期探测节流
  const login = { key: null, timer: null, stop: true };

  function authVerifiedRecently() { const a = authGet(); return !!(a && a.ts && Date.now() - a.ts < AUTH_TTL); }

  function parseQueryRaw(u) {
    const out = {};
    for (const kv of (u.split('?')[1] || '').split('&')) {
      const i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return out;
  }

  function drawQR(canvas, text) {
    let m;
    try { m = qrEncode(text); } catch (e) { return false; }
    const quiet = 4, scale = 3, dim = (m.size + quiet * 2) * scale;
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++)
      if (m.modules[r][c]) ctx.fillRect((quiet + c) * scale, (quiet + r) * scale, scale, scale);
    return true;
  }

  function loginStop() { login.stop = true; clearTimeout(login.timer); }

  function loginStart() {
    loginStop();
    login.stop = false;
    loginStatus.textContent = '正在生成二维码…';
    gmJSON('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {}, (d, err) => {
      if (login.stop) return;
      if (err || !d || d.code !== 0 || !d.data) { loginStatus.textContent = '生成失败：' + (err || apiMsg(d)); return; }
      login.key = d.data.qrcode_key;
      if (!drawQR(loginQr, d.data.url)) { loginStatus.textContent = '二维码生成失败'; return; }
      loginStatus.textContent = '等待扫码…';
      loginPoll();
    }, {});
  }

  function loginPoll() {
    if (login.stop) return;
    gmJSON('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', { qrcode_key: login.key }, (d, err) => {
      if (login.stop) return;
      if (err) { login.timer = setTimeout(loginPoll, 2500); return; }
      const c = d && d.data && d.data.code;
      if (c === 0) return loginSuccess(d.data);
      if (c === 86038) { loginStatus.textContent = '二维码已过期，正在刷新…'; login.timer = setTimeout(loginStart, 800); return; }
      if (c === 86090) loginStatus.textContent = '已扫码，请在手机上点击确认';
      else loginStatus.textContent = '等待扫码…';
      login.timer = setTimeout(loginPoll, 1800);
    }, {});
  }

  function loginSuccess(data) {
    // data.url 为 crossDomain 回调，携带账号 Cookie；请求它使其写入浏览器 Cookie 罐
    const q = parseQueryRaw(data.url || '');
    const a = authGet() || {};
    a.sessdata = q.SESSDATA || '';
    a.biliJct = q.bili_jct || '';
    a.dedeUserId = q.DedeUserID || '';
    a.refreshToken = data.refresh_token || '';   // 用于凭证静默续期
    a.ts = Date.now();
    S.set(K.auth, a);
    S.set(K.streams, {});   // 清空直链缓存，重新按账号取流
    if (data.url && isLoginCallback(data.url)) GM_xmlhttpRequest({ method: 'GET', url: data.url, timeout: 10000, onload: () => {}, onerror: () => {} });
    checkAuth({ announce: true, force: true });
  }

  // ---------------- Cookie 静默续期（refresh_token 流程） ----------------
  // 仅在 B 站标记 cookie 需要刷新时尝试：spi 取关联 → refresh（换新凭证）→ confirm 确认。
  // 任一步形状不符即放弃（保留旧凭证），绝不中途破坏可用会话。
  function tryCookieRefresh(done) {
    const a = authGet();
    if (!a || !a.sessdata || !a.biliJct || !a.refreshToken) return done(false);
    gmJSON('https://passport.bilibili.com/x/passport-login/web/cookie/info', {}, d0 => {
      if (!d0 || d0.code !== 0 || !d0.data || d0.data.refresh !== true) return done(false);
      gmJSON('https://api.bilibili.com/x/frontend/finger/spi', {}, d1 => {
        const b3 = d1 && d1.data && d1.data.b_3;
        if (!b3) return done(false);
        gmJSON('https://passport.bilibili.com/x/passport-login/web/cookie/refresh', { correlation_id: b3, csrf: a.biliJct }, d2 => {
          if (!d2 || d2.code !== 0 || !d2.data || !d2.data.refresh_token) return done(false);
          const nv = {};
          ((d2.data.cookie_info && d2.data.cookie_info.cookies) || []).forEach(c => { nv[c.name] = c.value; });
          if (!nv.SESSDATA || !nv.bili_jct) return done(false);
          // refresh 响应已把新 Cookie 写入浏览器罐；同步更新本地凭证
          a.sessdata = nv.SESSDATA; a.biliJct = nv.bili_jct; a.refreshToken = d2.data.refresh_token; a.ts = Date.now();
          S.set(K.auth, a);
          GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'SESSDATA=' + nv.SESSDATA + '; bili_jct=' + nv.bili_jct + '; DedeUserID=' + (a.dedeUserId || '') },
            data: 'csrf=' + encodeURIComponent(nv.bili_jct),
            timeout: 15000,
            onload: r => { let d3 = null; try { d3 = JSON.parse(r.responseText); } catch (e) {} done(!!(d3 && d3.code === 0)); },
            onerror: () => done(false),
            ontimeout: () => done(false)
          });
        }, { auth: true });
      }, {});
    }, { auth: true });
  }

  // opts: { announce: 校验成功时提示, expiryToast: 过期时提示, force: 跳过校验节流, cb: 回调 }
  function checkAuth(opts) {
    opts = opts || {};
    const finish = () => { renderLoginUI(); if (opts.cb) opts.cb(); };
    if (!opts.force && authVerifiedRecently()) return finish();
    authCheckedAt = Date.now();
    gmJSON(NAV_URL, {}, d => {
      if (d && d.code === 0 && d.data && d.data.isLogin) {
        applyAuth(d.data);
        const a = authGet();
        if (opts.announce) toast('登录成功：' + a.name);
        // 临期主动续期：cookie/info 标记需要刷新时静默换新（24h 节流）
        if (a.refreshToken && Date.now() - lastRefreshProbe > 24 * 60e3) {
          lastRefreshProbe = Date.now();
          gmJSON('https://passport.bilibili.com/x/passport-login/web/cookie/info', {}, dci => {
            if (dci && dci.code === 0 && dci.data && dci.data.refresh === true) {
              tryCookieRefresh(ok => { if (ok) toast('登录凭证已自动续期'); });
            }
          }, { auth: true });
        }
        return finish();
      }
      const a = authGet();
      if (a && a.sessdata) {
        // 本地凭证优先：带 Cookie 校验；失效则先尝试静默续期，失败才要求重新扫码
        gmJSON(NAV_URL, {}, d2 => {
          if (d2 && d2.code === 0 && d2.data && d2.data.isLogin) {
            applyAuth(d2.data);
            if (opts.announce) toast('登录成功：' + a.name);
            return finish();
          }
          tryCookieRefresh(renewed => {
            if (!renewed) { S.del(K.auth); if (opts.expiryToast) toast('登录已过期，请重新扫码'); return finish(); }
            gmJSON(NAV_URL, {}, d3 => {
              if (d3 && d3.code === 0 && d3.data && d3.data.isLogin) { applyAuth(d3.data); finish(); }
              else { S.del(K.auth); if (opts.expiryToast) toast('登录已过期，请重新扫码'); finish(); }
            }, {});
          });
        }, { auth: true });
        return;
      }
      finish();
    }, {});
  }

  function applyAuth(data) {
    const a = authGet() || {};
    a.name = data.uname || '';
    a.face = safeFace(data.face || '');
    a.mid = data.mid || 0;
    a.ts = Date.now();   // ts 同时充当“最近一次校验通过”的时间戳
    S.set(K.auth, a);
  }

  function logout() {
    S.del(K.auth);
    cfg.loginSkip = false;
    S.set(K.cfg, cfg);
    toast('已退出登录');
    renderLoginUI();
  }

  function renderLoginUI() {
    if (!uiReady) return;
    const a = authGet();
    const logged = a && (a.name || a.mid || a.sessdata);
    loginDone.hidden = !logged;
    loginBox.hidden = logged || cfg.loginSkip;
    loginOff.hidden = logged || !cfg.loginSkip;
    if (logged) {
      loginStop();
      loginName.textContent = a.name || ('账号 ' + (a.dedeUserId || ''));
      if (a.face) { loginFace.src = a.face; loginFace.hidden = false; } else loginFace.hidden = true;
    } else if (!cfg.loginSkip) {
      loginStart();
    }
  }

  // ---------------- 状态 ----------------
  function normalizeCfg(c) {
    c = c && typeof c === 'object' ? c : {};
    return {
      urls: Array.isArray(c.urls) ? c.urls.filter(u => typeof u === 'string' && u.trim()) : [],
      blur: +c.blur >= 0 && +c.blur <= 40 ? +c.blur : 16,
      vol: +c.vol > 0 && +c.vol <= 1 ? +c.vol : 0.9,
      mode: ['seq', 'shf', 'one'].includes(c.mode) ? c.mode : 'seq',
      x: c.x != null && isFinite(+c.x) ? +c.x : null,
      y: c.y != null && isFinite(+c.y) ? +c.y : null,
      mx: c.mx != null && isFinite(+c.mx) ? +c.mx : null,
      my: c.my != null && isFinite(+c.my) ? +c.my : null,
      mini: !!c.mini,
      loginSkip: !!c.loginSkip,
      confine: c.confine !== false,   // 默认策略：仅 B 站相关页面运行
      opacity: +c.opacity >= 0.3 && +c.opacity <= 1 ? +c.opacity : 1
    };
  }
  let cfg = normalizeCfg(S.get(K.cfg));
  let lastUrls = cfg.urls.slice();
  let tracks = [];                 // 由 cfg.urls + 元数据缓存展开
  let cur = { idx: -1, pos: 0, dur: 0, playing: false, title: '', cover: '' };
  let audio = null, pendingPos = 0;
  let isEngine = false, engineTimer = null;
  let hbState = null, hbRcAt = 0, lastCmdSeq = 0, shufflePrev = -1;
  const resolved = Object.create(null);   // b23.tv 短链解析缓存（会话内）

  // ---------------- 网络：元数据 / 音频流 ----------------
  function fetchMeta(id, cb) {
    const key = id.bvid || 'av' + id.aid;
    const cache = S.get(K.meta, {});
    if (cache[key] && cache[key].pages) return cb(cache[key]);
    gmJSON('https://api.bilibili.com/x/web-interface/view', id.bvid ? { bvid: id.bvid } : { aid: id.aid }, (d, err) => {
      if (err) return cb(null, err);
      if (!d || d.code !== 0 || !d.data) return cb(null, apiMsg(d));
      const v = d.data;
      const pages = (Array.isArray(v.pages) && v.pages.length ? v.pages : [{ cid: v.cid, part: '', duration: v.duration }])
        .map(p => ({ cid: p.cid, part: p.part || '', dur: p.duration || v.duration || 0 }));
      const m = { bvid: v.bvid, title: v.title, cover: safeImg(v.pic || ''), pages, ts: Date.now() };
      cache[key] = m;
      if (v.bvid && v.bvid !== key) cache[v.bvid] = m;
      const ks = Object.keys(cache); if (ks.length > 400) delete cache[ks[0]];
      S.set(K.meta, cache);
      cb(m);
    });
  }

  function fetchStream(t, cb, fail) {
    if (!t.cid) return fail('曲目尚未解析');
    const sc = S.get(K.streams, {});
    const hit = sc[t.cid];
    if (hit && hit.url && Date.now() - hit.ts < STREAM_TTL) return cb(hit.url);
    // 本地凭证优先；若带凭证取流失败（如凭证过期），自动退回匿名重试一次
    const attempt = useAuth => gmJSON('https://api.bilibili.com/x/player/playurl', { bvid: t.bvid, cid: t.cid, fnval: 16, platform: 'pc' }, (d, err) => {
      if (err) return useAuth ? attempt(false) : fail(err);
      if (!d || !d.data) return useAuth ? attempt(false) : fail(apiMsg(d));
      const data = d.data;
      let url = '';
      if (data.dash && data.dash.audio && data.dash.audio.length) {
        url = data.dash.audio.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0].baseUrl || '';
      } else if (data.durl && data.durl.length) {
        url = data.durl[0].url; // 兜底：低清晰度合并流，<audio> 只取其音轨
      }
      if (!url) return useAuth ? attempt(false) : fail('无法获取音频(' + d.code + ')');
      url = safeStream(url);
      if (!url) return fail('音频地址未通过安全校验');
      sc[t.cid] = { url, ts: Date.now() };
      S.set(K.streams, sc);
      cb(url);
    }, { auth: useAuth });
    attempt(!!authGet());
  }

  function resolveIfNeeded(u, cb) {
    const id = parseId(u);
    if (id) return cb(id);
    if (!/b23\.tv/.test(u)) return cb(null);
    GM_xmlhttpRequest({
      method: 'GET', url: u, timeout: 10000,
      onload: r => {
        const id2 = parseId(r.finalUrl || '') || parseId((r.responseText || '').slice(0, 3000));
        if (id2) resolved[u] = id2;
        cb(id2);
      },
      onerror: () => cb(null), ontimeout: () => cb(null)
    });
  }

  // ---------------- 曲目列表 ----------------
  function rebuildTracks() {
    const oldKey = cur.idx >= 0 && tracks[cur.idx] ? tracks[cur.idx].key : null;
    const oldU = cur.idx >= 0 && tracks[cur.idx] ? tracks[cur.idx].uIdx : null;
    const meta = S.get(K.meta, {});
    const next = [];
    cfg.urls.forEach((u, i) => {
      const id = resolved[u] || parseId(u);
      if (!id) { next.push({ key: 'bad:' + i, uIdx: i, bad: true, title: '无效链接' }); return; }
      const mkey = id.bvid || 'av' + id.aid;
      const m = meta[mkey];
      if (m && m.pages) {
        const pages = id.page ? m.pages.filter((x, xi) => xi + 1 === id.page) : m.pages;
        (pages.length ? pages : m.pages.slice(0, 1)).forEach(p => {
          next.push({ key: mkey + ':' + p.cid, uIdx: i, bvid: m.bvid, cid: p.cid, title: m.title, sub: m.pages.length > 1 ? p.part : '', cover: m.cover, dur: p.dur || 0, url: u });
        });
      } else {
        next.push({ key: 'meta:' + mkey + ':p' + (id.page || 0), uIdx: i, bvid: id.bvid, aid: id.aid, page: id.page || 0, pending: true, title: '解析中…', url: u });
      }
    });
    tracks = next;
    let ni = -1;
    if (oldKey != null) ni = tracks.findIndex(t => t.key === oldKey);
    if (ni < 0 && oldU != null) ni = tracks.findIndex(t => t.uIdx === oldU && !t.bad);
    cur.idx = ni;
    if (cur.idx < 0 && tracks.length) cur.idx = 0;
    // 列表被清空（或当前曲目被移除殆尽）时，引擎自动停止并重置状态
    if (isEngine && !tracks.length && audio) {
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
      cur.idx = -1; cur.pos = 0; cur.dur = 0; cur.playing = false; cur.title = ''; cur.cover = '';
    }
    syncCurFromTrack();
    renderAll();
    renderList();
  }

  function syncCurFromTrack() {
    if (!isEngine || cur.idx < 0 || !tracks[cur.idx]) return;
    const t = tracks[cur.idx];
    if (!t.bad && !t.pending) {
      cur.title = t.title + (t.sub ? ' · ' + t.sub : '');
      cur.cover = t.cover || '';
      cur.dur = t.dur || 0;
    }
  }

  let prefetchBusy = false, prefetchQueue = [];
  function prefetchAll() {
    if (!isEngine) return;
    // 重入安全：刷新待解析队列为当前列表中所有未就绪的条目
    prefetchQueue = cfg.urls.filter(u => {
      const id = resolved[u] || parseId(u);
      const key = id && (id.bvid || 'av' + id.aid);
      const c = key && S.get(K.meta, {})[key];
      return !(c && c.pages);
    });
    if (prefetchBusy || !prefetchQueue.length) { renderList(); return; }
    prefetchBusy = true;
    (function step() {
      const u = prefetchQueue.shift();
      if (!u) { prefetchBusy = false; renderList(); return; }
      resolveIfNeeded(u, id2 => {
        if (!id2) { renderList(); return setTimeout(step, 60); }
        fetchMeta(id2, () => { rebuildTracks(); setTimeout(step, 250); });
      });
    })();
  }

  // ---------------- 播放引擎 ----------------
  // ---------------- MediaSession：系统媒体键 / 媒体浮层（仅引擎端注册） ----------------
  let lastMediaKey = '';
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const seekBy = d => { if (audio) try { audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + d)); } catch (e) {} };
    try {
      ms.setActionHandler('play', () => { if (audio) audio.play().catch(() => {}); });
      ms.setActionHandler('pause', () => { if (audio) audio.pause(); });
      ms.setActionHandler('previoustrack', () => prevTrack());
      ms.setActionHandler('nexttrack', () => nextTrack());
      ms.setActionHandler('seekbackward', () => seekBy(-10));
      ms.setActionHandler('seekforward', () => seekBy(10));
      ms.setActionHandler('seekto', d => { if (audio && d.seekTime != null) try { audio.currentTime = d.seekTime; } catch (e) {} });
    } catch (e) {}
  }
  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = null;
      ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'].forEach(a => navigator.mediaSession.setActionHandler(a, null));
    } catch (e) {}
  }
  function updateMediaSessionMeta() {
    if (!isEngine || !('mediaSession' in navigator)) return;
    const key = (cur.title || '') + '|' + (cur.cover || '');
    if (key === lastMediaKey) return;
    lastMediaKey = key;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: cur.title || 'Bilibili 音乐卡片',
        artist: 'Bilibili',
        album: 'Bilibili 音乐卡片',
        artwork: cur.cover ? [{ src: cur.cover, sizes: '512x512', type: 'image/jpeg' }] : []
      });
    } catch (e) {}
  }
  function updatePositionState() {
    if (!isEngine || !('mediaSession' in navigator) || !audio || !isFinite(audio.duration) || audio.duration <= 0) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch (e) {}
  }

  // ---------------- 下一曲预加载 ----------------
  let preloadedIdx = -1, preloadDone = false;
  function peekNextIndex() {
    if (!tracks.length) return -1;
    if (cfg.mode === 'one') return -1;                                   // 单曲循环复用已缓存直链
    if (cfg.mode === 'shf' && tracks.length > 1) return randOther();
    return (cur.idx + 1) % tracks.length;
  }
  function preloadNext() {
    const ni = peekNextIndex();
    if (ni < 0 || ni >= tracks.length || !tracks[ni].cid) return;
    preloadedIdx = ni;
    fetchStream(tracks[ni], () => {}, () => {});   // 命中缓存时零开销；未缓存则预取直链
  }

  function syncPlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = cur.playing ? 'playing' : 'paused'; } catch (e) {}
  }

  // ---------------- 单曲续播记忆（每曲目记住播放位置） ----------------
  function saveTrackPos(key, pos, dur) {
    if (!key) return;
    const pm = S.get(K.posmap, {});
    // 起播不久或即将听完 → 移除记忆（下次从头播）
    if (!pos || pos < 30 || (dur && pos > dur - 30)) {
      if (pm[key]) { delete pm[key]; S.set(K.posmap, pm); }
      return;
    }
    pm[key] = { pos: Math.round(pos * 10) / 10, dur: Math.round((dur || 0) * 10) / 10, ts: Date.now() };
    const ks = Object.keys(pm);
    if (ks.length > 200) { ks.sort((a, b) => (pm[a].ts || 0) - (pm[b].ts || 0)); delete pm[ks[0]]; }   // LRU 上限 200
    S.set(K.posmap, pm);
  }
  function peekTrackPos(key) {
    if (!key) return 0;
    const e = S.get(K.posmap, {})[key];
    return e && e.pos > 30 && (!e.dur || e.pos < e.dur - 30) ? e.pos : 0;
  }

  // ---------------- 失败熔断：连续失败时停止轮换，避免与浏览器功能（如翻译）互相冲突 ----------------
  let failStreak = 0;
  const FAIL_LIMIT = 3;
  function skipToNext(reason) {
    failStreak++;
    if (failStreak >= FAIL_LIMIT) {
      failStreak = 0;
      if (audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {} }
      cur.playing = false;
      toast(reason + '；连续失败已暂停，点播放键重试（排查翻译/拦截类功能）');
      renderAll(); pushHB();
      return;
    }
    toast(reason + '，即将跳过下一首');
    setTimeout(() => nextTrack(), 1200);
  }

  function setupAudio() {
    if (audio) return;
    setupMediaSession();
    audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('referrerpolicy', 'no-referrer'); // B 站 CDN 要求空 Referer
    let lastSave = 0, lastPosSave = 0;
    audio.addEventListener('loadedmetadata', () => {
      cur.dur = audio.duration || 0;
      if (pendingPos > 0 && cur.dur && pendingPos < cur.dur - 1) { try { audio.currentTime = pendingPos; } catch (e) {} }
      pendingPos = 0;
      updatePositionState();
      renderAll(); pushHB();
    });
    audio.addEventListener('timeupdate', () => {
      cur.pos = audio.currentTime || 0;
      const now = Date.now();
      if (now - lastSave > 1000) {
        lastSave = now;
        renderTick();
        updatePositionState();
        if (!preloadDone && cur.dur > 0 && audio.currentTime >= cur.dur * 0.7) { preloadDone = true; preloadNext(); }
      }
      if (now - lastPosSave > 5000 && cur.idx >= 0 && tracks[cur.idx] && tracks[cur.idx].key) {
        lastPosSave = now;
        saveTrackPos(tracks[cur.idx].key, audio.currentTime, audio.duration);   // 单曲续播记忆
      }
    });
    audio.addEventListener('play', () => { cur.playing = true; syncPlaybackState(); renderAll(); pushHB(); });
    audio.addEventListener('pause', () => {
      cur.playing = false; syncPlaybackState(); renderAll(); pushHB();
      if (cur.idx >= 0 && tracks[cur.idx] && tracks[cur.idx].key) saveTrackPos(tracks[cur.idx].key, audio.currentTime, audio.duration);
    });
    // 卡顿检测：waiting/stalled 超过 4 秒 → 提示并暂停缓冲，缓冲足够后自动续播
    let stallT = null, stallByUs = false, stallResumeOk = false, stallToastAt = 0;
    const stallStart = () => {
      if (!cur.playing || stallByUs) return;
      clearTimeout(stallT);
      stallT = setTimeout(() => {
        if (audio.paused || !cur.playing) return;
        stallByUs = true; stallResumeOk = true;
        try { audio.pause(); } catch (e) {}
        if (Date.now() - stallToastAt > 60000) {
          stallToastAt = Date.now();
          toast('网络较慢，已暂停等待缓冲，稍后自动继续');
        }
        syncPlaybackState(); renderAll(); pushHB();
      }, 4000);
    };
    const stallResume = () => {
      clearTimeout(stallT);
      if (stallByUs && stallResumeOk) {
        stallByUs = false; stallResumeOk = false;
        audio.play().catch(() => {});
      }
    };
    audio.addEventListener('waiting', stallStart);
    audio.addEventListener('stalled', stallStart);
    audio.addEventListener('canplay', stallResume);
    audio.addEventListener('playing', () => { clearTimeout(stallT); stallByUs = false; stallResumeOk = false; });
    audio.addEventListener('ended', () => {
      if (cur.idx >= 0 && tracks[cur.idx] && tracks[cur.idx].key) {   // 听完整首 → 清除续播记忆
        const pm = S.get(K.posmap, {});
        delete pm[tracks[cur.idx].key];
        S.set(K.posmap, pm);
      }
      if (cfg.mode === 'one') { try { audio.currentTime = 0; } catch (e) {} audio.play().catch(() => {}); return; }
      if (cfg.mode === 'seq' && cur.idx >= tracks.length - 1) {
        cur.playing = false;   // 默认策略：顺序播放至列表末尾自动停止
        toast('播放列表已播完');
        renderAll(); pushHB();
        return;
      }
      nextTrack();
    });
    audio.addEventListener('error', () => {
      if (!audio.src) return;
      skipToNext('音频加载失败');
    });
  }

  function playAt(idx, opts) {
    opts = opts || {};
    if (!tracks.length) return;
    idx = ((idx % tracks.length) + tracks.length) % tracks.length;
    const t = tracks[idx];
    if (t.bad) { skipToNext('无效链接'); return; }
    // 切走前保存当前曲目的续播记忆
    if (isEngine && audio && cur.idx >= 0 && tracks[cur.idx] && tracks[cur.idx].key && tracks[cur.idx].key !== t.key) {
      saveTrackPos(tracks[cur.idx].key, audio.currentTime, audio.duration || cur.dur);
    }
    cur.idx = idx; cur.pos = 0; cur.dur = t.dur || 0; cur.playing = false;
    cur.title = t.title + (t.sub ? ' · ' + t.sub : '');
    cur.cover = t.cover || '';
    // 单曲续播记忆：未显式指定位置时，从上次听到的地方继续
    let startPos = opts.pos || 0;
    if (!startPos) startPos = peekTrackPos(t.key);
    renderAll(); pushHB();

    const go = () => {
      setupAudio();
      fetchStream(t, url => {
        failStreak = 0;   // 成功即清零连续失败计数
        pendingPos = startPos && (!cur.dur || startPos < cur.dur - 2) ? startPos : 0;
        audio.src = url;
        preloadDone = false;
        if (opts.autoplay !== false) audio.play().catch(() => toast('浏览器拦截了自动播放，点一下播放键'));
        setTimeout(preloadNext, 3000);   // 开播后预取下一首直链，切歌零等待
        renderAll(); pushHB();
      }, msg => skipToNext(msg));
    };

    if (t.pending) {
      fetchMeta({ bvid: t.bvid, aid: t.aid }, (m, err) => {
        if (!m) {
          t.bad = true; t.title = '解析失败';
          renderAll();
          skipToNext((err || '解析失败') + '（解析失败）');
          return;
        }
        rebuildTracks();
        const i = tracks.findIndex(x => x.uIdx === t.uIdx && !x.bad && !x.pending);
        if (i < 0) { skipToNext('解析失败'); return; }
        playAt(i, opts);
      });
      return;
    }
    go();
  }

  function randOther() { let n; do { n = Math.floor(Math.random() * tracks.length); } while (n === cur.idx && tracks.length > 1); return n; }

  function nextTrack() {
    if (!tracks.length) return;
    if (cfg.mode === 'shf' && tracks.length > 1) {
      shufflePrev = cur.idx;
      const n = (preloadedIdx >= 0 && preloadedIdx !== cur.idx && preloadedIdx < tracks.length) ? preloadedIdx : randOther();
      preloadedIdx = -1;
      playAt(n, { autoplay: true });
    } else playAt(cur.idx + 1, { autoplay: true });
  }

  function prevTrack() {
    if (!tracks.length) return;
    if (cfg.mode === 'shf' && tracks.length > 1) {
      const p = shufflePrev >= 0 ? shufflePrev : randOther();
      shufflePrev = cur.idx;
      playAt(p, { autoplay: true });
    } else playAt(cur.idx - 1, { autoplay: true });
  }

  function togglePlay() {
    if (isEngine) {
      if (!tracks.length) return openPanel();
      if (cur.idx < 0 || !audio || !audio.src) return playAt(cur.idx < 0 ? 0 : cur.idx, { autoplay: true });
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    } else if (hbLive()) sendCmd('toggle');
    else claimAndPlay(0);
  }

  function claimAndPlay(idx) {
    tryClaim(false);
    setTimeout(() => {
      if (isEngine && tracks.length) playAt(idx, { autoplay: true });
      else sendCmd('toggle');
    }, 700);
  }

  // ---------------- 多标签：引擎选举 / 心跳 / 指令 ----------------
  function pushHB() {
    if (!isEngine) return;
    S.set(K.hb, { id: MYID, ts: Date.now(), play: { idx: cur.idx, pos: cur.pos || 0, dur: cur.dur || 0, playing: !!cur.playing, title: cur.title, cover: cur.cover, bvid: (tracks[cur.idx] && tracks[cur.idx].bvid) || '' } });
  }
  function startEngineLoop() { pushHB(); if (engineTimer) clearInterval(engineTimer); engineTimer = setInterval(pushHB, HB_MS); }
  function hbLive() { return Date.now() - hbRcAt < STALE_MS; }

  function tryClaim(restore) {
    if (isEngine) return;
    const claim = { id: MYID, ts: Date.now() };
    S.set(K.claim, claim);
    setTimeout(() => {
      if (isEngine) return;
      const c = S.get(K.claim);
      if (c && c.id !== MYID && c.ts > claim.ts - 1000) return; // 别的标签页抢先成为引擎
      S.set(K.claim, claim);
      becomeEngine(restore);
    }, 280 + Math.random() * 240);
  }

  function becomeEngine(restore) {
    isEngine = true;
    setupAudio();
    audio.volume = cfg.vol;
    const last = restore ? (S.get(K.hb) || {}).play : null;
    rebuildTracks();
    prefetchAll();   // 启动恢复时继续解析未完成的条目（否则重载后永远停在“解析中…”）
    startEngineLoop();
    if (tracks.length) {
      const idx = last && last.idx >= 0 && last.idx < tracks.length ? last.idx : 0;
      playAt(idx, { pos: last ? last.pos || 0 : 0, autoplay: !!(last && last.playing) });
    }
    console.log('[BMC] 成为播放引擎 #' + MYID);
  }

  function demote(reason) {
    if (!isEngine) return;
    isEngine = false;
    if (engineTimer) { clearInterval(engineTimer); engineTimer = null; }
    if (audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {} }
    clearMediaSession();   // 让出引擎时释放系统媒体键
    hbState = S.get(K.hb); hbRcAt = hbState && hbState.ts ? Date.now() : 0;
    renderAll();
    console.log('[BMC] 让出引擎：', reason);
  }

  function becomeRemote() {
    isEngine = false;
    hbState = S.get(K.hb);
    hbRcAt = hbState && hbState.ts ? Date.now() : 0;
    renderAll();
  }

  function sendCmd(type, payload) {
    S.set(K.cmd, { type, payload, from: MYID, seq: Date.now() + Math.random() });
  }

  function handleCmd(v) {
    if (v.type === 'toggle') togglePlay();
    else if (v.type === 'pause') { if (audio && !audio.paused) audio.pause(); }
    else if (v.type === 'next') nextTrack();
    else if (v.type === 'prev') prevTrack();
    else if (v.type === 'seek') { if (audio && cur.dur) { try { audio.currentTime = v.payload * cur.dur; } catch (e) {} } }
    else if (v.type === 'playUrl') {
      let i = tracks.findIndex(t => t.uIdx === v.payload && !t.bad && !t.pending);
      if (i < 0) { const t = tracks.find(t => t.uIdx === v.payload && !t.bad); if (t) i = tracks.indexOf(t); }
      if (i >= 0) playAt(i, { autoplay: true });
    } else if (v.type === 'ping') pushHB();
  }

  function view() {
    if (isEngine) return cur;
    const p = (hbState && hbState.play) || {};
    return { idx: p.idx != null ? p.idx : -1, pos: p.pos || 0, dur: p.dur || 0, playing: !!p.playing, title: p.title, cover: p.cover, bvid: p.bvid || '' };
  }

  // ---------------- UI ----------------
  let card, bgImg, coverImg, titleEl, bar, tcur, tdur, bPlay, bMode, bPrev, bNext, volEl, bVol, bCfg, toastEl, panel, pAdd, pHint, pBlur, pBlurV, pOp, pOpV, pVol, pVolV, pList, pClose, pQuick, bigPanel, bigList, bigTitle, bigSearch, bigPin, bigExport, bigImport, impBox, impText, impOk, impCancel, bigTip, mMode, mTool, mCount, mAll, mInv, mNone, mTop, mBottom, mRemove, mSort, mUndo;
  let bigPinned = false;   // 图钉状态：钉住后面板关闭时放大窗保持打开
  let loginBox, loginQr, loginStatus, loginOff, loginDone, loginFace, loginName;
  let rootRef = null;
  let updVolDot = null, updVolPDot = null, updBlurDot = null, updOpDot = null;
  const glowMap = new Map();   // 新添加行的发光强调：uIdx -> 加入时刻
  let manageMode = false, sel = new Set(), undoStack = [], sortMode = 0;
  const SORTS = [['manual', '手动'], ['title', '按标题'], ['dur', '按时长'], ['added', '按添加'], ['shuffle', '打乱']];
  let dragFrom = -1;           // 列表拖拽源索引（面板/大窗共用）
  // 网页视频播放检测：本页有视频在播时暂停插件（每轮视频播放只打断一次，手动恢复后不再打扰）
  let vidPlayingPrev = false, vidPauseArmed = true, vidToastGate = 0;
  let uiReady = false;         // buildUI 完成前跳过所有 DOM 渲染（纯逻辑调用场景）

  // 档位小圆点：跟随滑杆拇指实时显示数值，并同步写入 --p 驱动浅色填充条动画（同类控件统一挂载）
  function attachValueDot(input, fmt) {
    const wrap = input.parentNode;
    const dot = document.createElement('div');
    dot.className = 'vdot';
    wrap.appendChild(dot);
    const update = () => {
      const min = input.min === '' ? 0 : +input.min;
      const max = input.max === '' ? 100 : +input.max;
      const pct = max > min ? (+input.value - min) / (max - min) * 100 : 0;
      input.style.setProperty('--p', pct.toFixed(1) + '%');
      dot.style.left = `calc(${pct.toFixed(1)}% + ${(5 - pct / 10).toFixed(1)}px)`; // 抵消拇指宽度偏移
      dot.textContent = fmt ? fmt(+input.value) : String(input.value);
    };
    input.addEventListener('input', update);
    update();
    return update;
  }
  let barDragging = false, lastCoverSet = null, toastTimer = null, blurT = null, opT = null;

  const CSS = `
/* 主题变量：深色默认，浅色跟随系统 prefers-color-scheme（纯 CSS，无切换按钮） */
/* --op 为玻璃不透明度系数（面板滑杆可调，0.3~1），乘算到全部玻璃底色 */
#card,#panel,#bigPanel{
  --fg:#fff;--fg85:rgba(255,255,255,.85);--fg75:rgba(255,255,255,.75);--fg55:rgba(255,255,255,.55);--fg45:rgba(255,255,255,.45);--fg40:rgba(255,255,255,.4);
  --hover:rgba(255,255,255,.14);--hover2:rgba(255,255,255,.08);--input:rgba(255,255,255,.08);
  --line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.14);--line3:rgba(255,255,255,.35);--lgline:rgba(255,255,255,.25);
  --glassRGB:24,24,28;--glassA:.30;--glass2RGB:22,22,26;--glass2A:.50;--glass3RGB:20,20,24;--glass3A:.75;
  --glass:rgba(var(--glassRGB),calc(var(--glassA) * var(--op,1)));
  --glass2:rgba(var(--glass2RGB),calc(var(--glass2A) * var(--op,1)));
  --glass3:rgba(var(--glass3RGB),calc(var(--glass3A) * var(--op,1)));
  --track:rgba(0,0,0,.42);--fill:#fff;--thumb:#fff;
  --accent:#ff5c7a;--dotbg:#fff;--dotfg:#17171c;
  --toastbg:rgba(0,0,0,.6);--toastfg:#fff;
  --shade:linear-gradient(180deg,rgba(0,0,0,.16),rgba(0,0,0,.40));--bright:.62;--tshadow:0 1px 3px rgba(0,0,0,.45)}
@media (prefers-color-scheme:light){
  #card,#panel,#bigPanel{
    --fg:#1c1c1e;--fg85:rgba(0,0,0,.82);--fg75:rgba(0,0,0,.72);--fg55:rgba(0,0,0,.55);--fg45:rgba(0,0,0,.45);--fg40:rgba(0,0,0,.4);
    --hover:rgba(0,0,0,.1);--hover2:rgba(0,0,0,.06);--input:rgba(0,0,0,.05);
    --line:rgba(0,0,0,.08);--line2:rgba(0,0,0,.14);--line3:rgba(0,0,0,.35);--lgline:rgba(0,0,0,.2);
    --glassRGB:255,255,255;--glassA:.52;--glass2RGB:248,248,250;--glass2A:.58;--glass3RGB:252,252,254;--glass3A:.82;
    --glass:rgba(var(--glassRGB),calc(var(--glassA) * var(--op,1)));
    --glass2:rgba(var(--glass2RGB),calc(var(--glass2A) * var(--op,1)));
    --glass3:rgba(var(--glass3RGB),calc(var(--glass3A) * var(--op,1)));
    --track:rgba(0,0,0,.15);--fill:#1c1c1e;--thumb:#fff;
    --dotbg:#1c1c1e;--dotfg:#fff;
    --toastbg:rgba(255,255,255,.88);--toastfg:#1c1c1e;
    --shade:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.44));--bright:.85;--tshadow:none}}
:host{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none}
*{box-sizing:border-box;margin:0;padding:0}
#card{position:fixed;z-index:2147483647;width:320px;border-radius:20px;overflow:clip;color:var(--fg);pointer-events:auto;cursor:default;user-select:none;touch-action:none;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;
  background:var(--glass);backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);
  box-shadow:0 18px 50px rgba(0,0,0,.35),0 0 0 1px var(--line) inset}
#bgClip{position:absolute;inset:0;overflow:clip;border-radius:20px;pointer-events:none;z-index:0}
#bg{position:absolute;left:-26px;top:-26px;width:calc(100% + 52px);height:calc(100% + 52px);object-fit:cover;transform:scale(1.1);
  filter:blur(var(--bmc-blur,16px)) saturate(1.6) brightness(var(--bright));transition:filter .25s}
#shade{position:absolute;inset:0;background:var(--shade);pointer-events:none;z-index:2}
#body{position:relative;z-index:3;display:flex;gap:12px;padding:12px;align-items:stretch}
#cover{width:72px;height:72px;border-radius:12px;object-fit:cover;display:block;background:var(--hover2);
  box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;flex:none}
#right{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;padding:1px 0}
#title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:var(--tshadow);cursor:pointer}
#prow{display:flex;align-items:center;gap:6px}
#tcur,#tdur{font-size:10px;color:var(--fg75);font-variant-numeric:tabular-nums;width:30px;text-align:center;flex:none}
#bar{flex:1;min-width:0}
#controls{display:flex;align-items:center;gap:7px}
.btn{width:28px;height:28px;border:0;background:transparent;color:var(--fg85);cursor:pointer;display:grid;place-items:center;border-radius:50%;padding:0;transition:background .15s,color .15s;flex:none}
.btn:hover{color:var(--fg);background:var(--hover)}
.btn.active{color:var(--accent)}
.btn svg{width:15px;height:15px}
.btn.play svg{width:18px;height:18px}
#volWrap{position:relative;display:flex;align-items:center;margin-left:auto}
#volPop{position:absolute;right:-6px;bottom:38px;width:112px;padding:10px 12px;border-radius:10px;background:var(--glass3);
  backdrop-filter:blur(var(--bmc-blur,16px));-webkit-backdrop-filter:blur(var(--bmc-blur,16px));box-shadow:0 6px 24px rgba(0,0,0,.25),0 0 0 1px var(--line2) inset;
  opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .18s,transform .18s}
#volWrap:hover #volPop,#volPop.open{opacity:1;pointer-events:auto;transform:translateY(0)}
#vol{width:100%}
#vol::-webkit-slider-thumb{opacity:1}
#vol::-moz-range-thumb{opacity:1}
/* 带实时档位小圆点的滑杆（同类功能统一复用 .sl + vdot） */
.sl{position:relative;display:flex;flex:1;min-width:0}
#volPop .sl{display:block;width:100%}
.vdot{position:absolute;bottom:calc(100% + 5px);min-width:18px;height:16px;padding:0 5px;border-radius:9px;background:var(--dotbg);color:var(--dotfg);font-size:9px;font-weight:700;line-height:16px;text-align:center;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
.sl:hover .vdot,.vdot.on{opacity:1}
input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;height:18px;cursor:pointer;transition:--p .16s ease-out}
input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--fill) var(--p,0%),var(--track) var(--p,0%))}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;margin-top:-3px;border-radius:50%;background:var(--thumb);box-shadow:0 1px 5px rgba(0,0,0,.45);opacity:0;transition:opacity .15s,transform .12s}
/* 滑动时显示小圆球拇指并微放大，增强操作确认感 */
.sl:hover input[type=range]::-webkit-slider-thumb,input[type=range]:active::-webkit-slider-thumb{opacity:1}
input[type=range]:active::-webkit-slider-thumb{transform:scale(1.35)}
#prow:hover #bar::-webkit-slider-thumb,#bar:active::-webkit-slider-thumb{opacity:1}
#volWrap:hover #vol::-webkit-slider-thumb,#vol:active::-webkit-slider-thumb{opacity:1}
input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--track)}
input[type=range]::-moz-range-progress{height:4px;border-radius:2px;background:var(--fill)}
input[type=range]::-moz-range-thumb{width:10px;height:10px;border:0;border-radius:50%;background:var(--thumb);opacity:0}
#toast{position:absolute;top:8px;left:50%;transform:translateX(-50%) translateY(-4px);background:var(--toastbg);backdrop-filter:blur(8px);
  border-radius:99px;padding:4px 12px;font-size:11px;color:var(--toastfg);opacity:0;pointer-events:none;transition:.25s;z-index:9;white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis}
#toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
#card.mini{width:auto;cursor:grab}
#card.mini #right{display:none}
#card.mini #body{padding:6px}
#card.mini #cover{width:56px;height:56px}
#card.dragging{cursor:grabbing}
#card.glide{transition:left .24s ease,top .24s ease}
#cover{-webkit-user-drag:none}
#panel{position:fixed;z-index:2147483647;width:344px;max-height:min(480px,72vh);display:flex;flex-direction:column;gap:10px;padding:14px;pointer-events:auto;
  border-radius:18px;color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;
  background:var(--glass2);backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);
  box-shadow:0 18px 50px rgba(0,0,0,.35),0 0 0 1px var(--line2) inset}
#panel[hidden]{display:none}
#pHead{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700}
#pHead .hbtns{display:flex;gap:6px}
/* 放大列表窗口（居中大窗，支持移除/拖拽排序） */
#bigPanel{position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:min(640px,84vh);
  display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:18px;color:var(--fg);pointer-events:auto;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;
  background:var(--glass2);backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);
  box-shadow:0 24px 70px rgba(0,0,0,.45),0 0 0 1px var(--line2) inset}
#bigPanel[hidden]{display:none}
#bigHead{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700}
#bigHead .hbtns{display:flex;gap:6px;align-items:center}
#bigPin{transition:background .18s,color .18s,transform .18s}
#bigPin.pinned{color:#fff;background:#fa2d48;transform:rotate(-45deg)}
#bigClear.armed{background:#fa2d48;border-color:transparent;color:#fff}
#bigList{position:relative;overflow:auto;flex:1;min-height:0}
#bigList::-webkit-scrollbar{width:6px}
#bigList::-webkit-scrollbar-thumb{background:var(--fg40);border-radius:3px}
#bigList .vinner{position:relative;width:100%}
#bigList .vrow{position:absolute;left:0;right:0;height:30px;padding:0 8px}
.vhint{padding:8px;text-align:center;font-size:11px;color:var(--fg40);cursor:pointer}
#bigTip{font-size:10px;color:var(--fg40);text-align:right;flex:none}
/* 导入分享码子窗（覆盖在放大窗内部） */
#impBox{position:absolute;inset:0;border-radius:18px;background:var(--glass3);backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--bmc-blur,16px)) saturate(1.6);
  display:flex;flex-direction:column;gap:10px;padding:16px;z-index:6}
#impBox[hidden]{display:none}
#impText{flex:1;min-height:100px;background:var(--input);border:1px solid var(--line2);border-radius:10px;color:var(--fg);padding:10px;font-size:12px;font-family:ui-monospace,Consolas,monospace;line-height:1.5;resize:none;outline:none;word-break:break-all}
#impText:focus{border-color:var(--line3)}
#impBtns{display:flex;gap:8px;justify-content:flex-end}
/* 管理模式批量工具条（仅在管理模式出现） */
#mTool{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px}
#mTool[hidden]{display:none}
#mCount{color:var(--accent);font-weight:700;margin-right:2px}
.tbtn{border:1px solid var(--line2);background:var(--input);color:var(--fg75);font-size:11px;padding:3px 9px;border-radius:8px;cursor:pointer;font-family:inherit;transition:.15s}
.tbtn:hover{background:var(--hover);color:var(--fg)}
.tbtn.warn:hover{color:#ff6b6b;border-color:rgba(255,107,107,.5)}
.tsep{width:1px;height:14px;background:var(--line2);margin:0 2px}
/* 放大窗虚拟滚动：行绝对定位 */
#bigList{position:relative;overflow:auto;flex:1;min-height:0}
#bigList::-webkit-scrollbar{width:6px}
#bigList::-webkit-scrollbar-thumb{background:var(--fg40);border-radius:3px}
#bigList .vrow{position:absolute;left:0;right:0;height:30px;padding:0 8px}
.vhint{padding:8px;text-align:center;font-size:11px;color:var(--fg40)}
/* 新加入视频的短暂发光强调（围绕标题，不改变布局） */
.row .t{border-radius:6px}
.row .t.glow{padding:3px 6px;margin:-3px -6px;animation:bmcglow 1.8s ease-out}
@keyframes bmcglow{0%{box-shadow:0 0 0 0 rgba(250,45,72,0);background:rgba(250,45,72,.30)}20%{box-shadow:0 0 14px 3px rgba(250,45,72,.55);background:rgba(250,45,72,.16)}100%{box-shadow:0 0 0 0 rgba(250,45,72,0);background:transparent}}
#loginBox{display:flex;gap:12px;align-items:center;background:var(--hover2);border:1px solid var(--line2);border-radius:12px;padding:10px}
#loginBox[hidden],#loginDone[hidden],#loginOff[hidden]{display:none}
#loginQrWrap{flex:none;width:126px;height:126px;background:#fff;border-radius:10px;display:grid;place-items:center;overflow:hidden}
#loginQr{width:118px;height:118px;display:block}
#loginInfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
#loginTitle{font-size:12px;font-weight:700}
#loginStatus{font-size:11px;color:var(--fg85);font-variant-numeric:tabular-nums}
#loginTip{font-size:10px;color:var(--fg45);line-height:1.5}
#loginBtns{display:flex;gap:6px;margin-top:2px}
.lgbtn{border:1px solid var(--lgline);background:var(--input);color:var(--fg85);font-size:11px;padding:4px 10px;border-radius:8px;cursor:pointer;font-family:inherit;transition:.15s}
.lgbtn:hover{background:var(--hover);color:var(--fg)}
#loginDone,#loginOff{display:flex;align-items:center;gap:10px;background:var(--hover2);border:1px solid var(--line2);border-radius:12px;padding:8px 10px;font-size:12px}
#loginFace{width:28px;height:28px;border-radius:50%;object-fit:cover;background:var(--hover2)}
#loginName{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#loginOff span{flex:1;color:var(--fg55);font-size:11px}
#pAdd,#bigSearch{flex:1;min-width:0;height:32px;background:var(--input);border:1px solid var(--line2);border-radius:10px;color:var(--fg);padding:0 10px;font-size:12px;font-family:inherit;outline:none}
#pAdd:focus,#bigSearch:focus{border-color:var(--line3)}
#pAdd::placeholder,#bigSearch::placeholder{color:var(--fg40)}
#pHint{font-size:11px;color:var(--fg55);margin-top:-4px}
/* 滑杆行统一布局：标签固定宽且右对齐（贴向滑杆）+ 滑杆 + 档位值右对齐，后续同类条目复用 .srow */
.srow{display:flex;align-items:center;gap:8px}
.slabel{flex:none;width:56px;text-align:right;font-size:11px;color:var(--fg75)}
.sval{flex:none;min-width:22px;text-align:right;font-size:11px;color:var(--fg75);font-variant-numeric:tabular-nums}
#pBlur{flex:1}

#pList{overflow:auto;display:flex;flex-direction:column;gap:2px;min-height:0}
#pList::-webkit-scrollbar{width:6px}
#pList::-webkit-scrollbar-thumb{background:var(--fg40);border-radius:3px}
.row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12px;flex:none}
.row:hover{background:var(--hover2)}
.row.playing{background:var(--hover2)}
.row.playing .n{color:var(--accent)}
.row.playing .t{color:var(--accent);font-weight:600}
.row.msel{background:rgba(250,45,72,.18);box-shadow:inset 0 0 0 1px rgba(250,45,72,.45)}
.row.msel .n{color:var(--accent);font-weight:700}
.row .n{color:var(--fg40);font-size:11px;width:18px;text-align:right;flex:none;font-variant-numeric:tabular-nums}
.row .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .t.wait{color:var(--fg45)}
.row .rm{flex:none;border:0;background:none;color:var(--fg45);cursor:pointer;font-size:13px;padding:2px 5px;border-radius:6px;line-height:1}
.row .rm:hover{color:#ff6b6b;background:var(--hover2)}
.row .op{flex:none;width:20px;height:20px;border:0;background:none;color:var(--fg45);cursor:pointer;border-radius:6px;display:grid;place-items:center;padding:0;transition:.15s}
.row .op:hover{color:var(--fg);background:var(--hover)}
.row .op svg{width:11px;height:11px}
.row.dragging{opacity:.35}
.row.dtop{box-shadow:inset 0 2px 0 0 var(--accent)}
.row.dbottom{box-shadow:inset 0 -2px 0 0 var(--accent)}
#pQuick{display:flex;gap:6px;flex-wrap:wrap}
#pQuick[hidden]{display:none}
#pQuick .lgbtn{border-color:rgba(250,45,72,.55);color:#ff8fa0;background:rgba(250,45,72,.12)}
#pQuick .lgbtn:hover{background:rgba(250,45,72,.25);color:#fff}
#pFoot{display:flex;align-items:center;gap:10px;flex:none}
#pTip{font-size:10px;color:var(--fg40);flex:1;text-align:right}
`;

  // ---------------- B 站网页全屏 / 直播页自动隐藏 ----------------
  // 网页全屏或打开直播页时，悬浮卡片会遮挡内容：检测到即隐藏整个组件（卡片/面板/放大窗），解除后恢复
  let hostEl = null, webFsHidden = false, webFsT = null;
  function webFsOn() {
    return !!document.querySelector(
      '.bpx-player-container[data-screen="web"], .player-mode-webfullscreen'
    );
  }
  function onLivePage() {
    return /(^|\.)live\.bilibili\.com$/.test(location.hostname);
  }
  function applyWebFs() {
    const on = webFsOn() || onLivePage();
    if (on === webFsHidden) return;
    webFsHidden = on;
    if (hostEl) hostEl.style.display = on ? 'none' : '';
  }
  function startWebFsWatch() {
    applyWebFs();
    // 直播页判定基于 location（SPA 路由不触发属性变化）→ 轮询兜底
    setInterval(applyWebFs, 2000);
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(() => {
      clearTimeout(webFsT);
      webFsT = setTimeout(applyWebFs, 120);   // 去抖：播放器类名切换频繁
    });
    mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'data-screen'] });
  }

  function buildUI() {
    const host = document.createElement('div');
    host.id = 'bmc-host';
    hostEl = host;
    const root = host.attachShadow({ mode: 'closed' }); // closed：宿主页面不可探查卡片内部（昵称/头像等）
    rootRef = root;
    // 注册 --p 为可过渡属性（文档级；shadow 内注册在部分内核不生效）
    if (!document.getElementById('bmc-preg')) {
      const st = document.createElement('style');
      st.id = 'bmc-preg';
      st.textContent = '@property --p{syntax:"<percentage>";inherits:true;initial-value:0%}';
      document.head.appendChild(st);
    }
    root.innerHTML = `<style>${CSS}</style>
<div id="card">
  <div id="bgClip"><img id="bg" alt="" referrerpolicy="no-referrer"></div>
  <div id="shade"></div>
  <div id="body">
    <img id="cover" alt="" draggable="false" referrerpolicy="no-referrer">
    <div id="right">
      <div id="title">Bilibili 音乐卡片</div>
      <div id="prow"><span id="tcur">0:00</span><input id="bar" type="range" min="0" max="1000" value="0"><span id="tdur">0:00</span></div>
      <div id="controls">
        <button id="bMode" class="btn" title="顺序播放"></button>
        <button id="bPrev" class="btn" title="上一首"></button>
        <button id="bPlay" class="btn play" title="播放 / 暂停"></button>
        <button id="bNext" class="btn" title="下一首"></button>
        <div id="volWrap"><button id="bVol" class="btn" title="音量"></button><div id="volPop"><div class="sl"><input id="vol" type="range" min="0" max="100" value="90"></div></div></div>
        <button id="bCfg" class="btn" title="播放列表与设置"></button>
      </div>
    </div>
  </div>
  <div id="toast"></div>
</div>
<div id="panel" hidden>
  <div id="pHead"><span>播放列表与设置</span><div class="hbtns"><button id="bigBtn" class="btn" title="放大列表"></button><button id="pClose" class="btn" title="关闭"></button></div></div>
  <div id="loginBox" hidden>
    <div id="loginQrWrap"><canvas id="loginQr"></canvas></div>
    <div id="loginInfo">
      <div id="loginTitle">登录 B 站账号</div>
      <div id="loginStatus">正在生成二维码…</div>
      <div id="loginTip">打开哔哩哔哩 APP 扫一扫登录；账号取流可获得更高音质并解锁受限视频</div>
      <div id="loginBtns"><button class="lgbtn" id="loginSkip">暂不登录</button></div>
    </div>
  </div>
  <div id="loginDone" hidden>
    <img id="loginFace" referrerpolicy="no-referrer" alt="">
    <span id="loginName"></span>
    <button class="lgbtn" id="loginOut">退出登录</button>
  </div>
  <div id="loginOff" hidden>
    <span>未登录（音质受限）</span>
    <button class="lgbtn" id="loginOn">扫码登录</button>
  </div>
  <div class="srow"><input id="pAdd" type="text" placeholder="粘贴链接后回车添加（BV / av / b23.tv / 分P）" spellcheck="false" autocomplete="off"></div>
  <div id="pHint">回车添加 · 支持空格分隔批量粘贴 · 播放列表 0 个</div>
  <div id="pQuick" hidden></div>
  <div class="srow"><span class="slabel">背景模糊</span><div class="sl"><input id="pBlur" type="range" min="0" max="40"></div><span class="sval" id="pBlurV">16</span></div>
  <div class="srow"><span class="slabel">不透明度</span><div class="sl"><input id="pOp" type="range" min="30" max="100"></div><span class="sval" id="pOpV">100</span></div>
  <div class="srow"><span class="slabel">音量</span><div class="sl"><input id="pVol" type="range" min="0" max="100"></div><span class="sval" id="pVolV">90</span></div>
  <div id="pList"></div>
  <div id="pFoot"><span id="pTip">双击卡片切换迷你模式 · 卡片可拖动</span></div>
</div>
<div id="bigPanel" hidden>
  <div id="bigHead"><span id="bigTitle">播放列表</span><div class="hbtns"><button id="mMode" class="lgbtn">管理</button><button id="bigExport" class="lgbtn" title="复制分享码到剪贴板">导出</button><button id="bigImport" class="lgbtn" title="从分享码导入">导入</button><button id="bigPin" class="btn" title="钉住（面板关闭时保持打开）"></button><button id="bigClose" class="btn" title="关闭"></button></div></div>
  <div class="srow"><input id="bigSearch" type="text" placeholder="搜索列表中的视频…" spellcheck="false" autocomplete="off"></div>
  <div id="mTool" hidden>
    <span id="mCount">已选 0</span>
    <button class="tbtn" id="mAll">全选</button>
    <button class="tbtn" id="mInv">反选</button>
    <button class="tbtn" id="mNone">清选</button>
    <span class="tsep"></span>
    <button class="tbtn" id="mTop">置顶</button>
    <button class="tbtn" id="mBottom">置底</button>
    <button class="tbtn" id="mRemove">移除</button>
    <span class="tsep"></span>
    <button class="tbtn" id="mSort">排序·手动</button>
    <button class="tbtn" id="mUndo">撤销</button>
  </div>
  <div id="bigList"></div>
  <div id="impBox" hidden>
    <div style="font-size:12px;font-weight:700">导入分享码</div>
    <textarea id="impText" rows="4" placeholder="粘贴 BMC1. 开头的分享码，导入的视频将加入列表顶部且不覆盖现有内容" spellcheck="false"></textarea>
    <div id="impBtns"><button class="lgbtn" id="impCancel">取消</button><button class="lgbtn" id="impOk">确认导入</button></div>
  </div>
  <div id="bigTip">拖动调整顺序 · ↑↓ 微调 · ✕ 移除</div>
</div>`;
    document.documentElement.appendChild(host);

    const q = s => root.querySelector(s);
    card = q('#card'); bgImg = q('#bg'); coverImg = q('#cover'); titleEl = q('#title');
    bar = q('#bar'); tcur = q('#tcur'); tdur = q('#tdur');
    bPlay = q('#bPlay'); bMode = q('#bMode'); bPrev = q('#bPrev'); bNext = q('#bNext');
    volEl = q('#vol'); bCfg = q('#bCfg'); toastEl = q('#toast');
    panel = q('#panel'); pAdd = q('#pAdd'); pHint = q('#pHint');
    pBlur = q('#pBlur'); pBlurV = q('#pBlurV'); pOp = q('#pOp'); pOpV = q('#pOpV'); pList = q('#pList'); pClose = q('#pClose');
    bigPanel = q('#bigPanel'); bigList = q('#bigList'); bigTitle = q('#bigTitle'); bigSearch = q('#bigSearch'); bigTip = q('#bigTip');
    const bigBtn = q('#bigBtn'), bigClose = q('#bigClose');
    bigExport = q('#bigExport'); bigImport = q('#bigImport'); impBox = q('#impBox'); impText = q('#impText'); impOk = q('#impOk'); impCancel = q('#impCancel');
    bigPin = q('#bigPin');
    mMode = q('#mMode'); mTool = q('#mTool'); mCount = q('#mCount');
    mAll = q('#mAll'); mInv = q('#mInv'); mNone = q('#mNone'); mTop = q('#mTop'); mBottom = q('#mBottom'); mRemove = q('#mRemove'); mSort = q('#mSort'); mUndo = q('#mUndo');
    mRemove.classList.add('warn');
    bigBtn.innerHTML = I.big; bigClose.innerHTML = I.close; bigPin.innerHTML = I.pin;
    bigBtn.addEventListener('click', openBig);
    bigClose.addEventListener('click', () => { bigPanel.hidden = true; });
    bigSearch.addEventListener('input', renderList);
    let vTick = false;
    bigList.addEventListener('scroll', () => {   // 虚拟滚动：rAF 节流重渲染可见区
      if (vTick) return;
      vTick = true;
      requestAnimationFrame(() => { vTick = false; if (!bigPanel.hidden) renderBig(); });
    });
    bigExport.addEventListener('click', exportPlaylist);
    bigImport.addEventListener('click', () => { impBox.hidden = false; impText.value = ''; impText.focus(); });
    impCancel.addEventListener('click', () => { impBox.hidden = true; });
    impOk.addEventListener('click', importShare);
    bigPin.addEventListener('click', () => {
      bigPinned = !bigPinned;
      bigPin.classList.toggle('pinned', bigPinned);
      bigPin.title = bigPinned ? '已钉住：面板关闭时放大窗保持打开（点击取消）' : '钉住（面板关闭时保持打开）';
      bigTip.textContent = bigPinned ? '已固定：关闭设置面板后本窗口保持打开' : '拖动调整顺序 · ↑↓ 微调 · ✕ 移除';
    });
    // 管理模式：平时无任何多余按钮，点「管理」才出现批量工具条
    mMode.addEventListener('click', () => {
      manageMode = !manageMode;
      sel.clear();
      mTool.hidden = !manageMode;
      mMode.textContent = manageMode ? '完成' : '管理';
      mMode.style.borderColor = manageMode ? 'rgba(250,45,72,.55)' : '';
      mCount.textContent = '已选 0';
      renderBig();
    });
    mAll.addEventListener('click', () => { searchScope().forEach(i => sel.add(i)); mCount.textContent = '已选 ' + sel.size; renderBig(); });
    mInv.addEventListener('click', () => { searchScope().forEach(i => { if (sel.has(i)) sel.delete(i); else sel.add(i); }); mCount.textContent = '已选 ' + sel.size; renderBig(); });
    mNone.addEventListener('click', () => { sel.clear(); mCount.textContent = '已选 0'; renderBig(); });
    mTop.addEventListener('click', () => batchEdge([...sel], true));
    mBottom.addEventListener('click', () => batchEdge([...sel], false));
    mRemove.addEventListener('click', () => batchRemove([...sel]));
    mSort.addEventListener('click', () => {
      sortMode = (sortMode + 1) % SORTS.length;
      const m = SORTS[sortMode][0];
      mSort.textContent = '排序·' + SORTS[sortMode][1];
      applySort(m);
    });
    mUndo.addEventListener('click', undoBatch);
    pVol = q('#pVol'); pVolV = q('#pVolV');
    bVol = q('#bVol');
    const volPop = q('#volPop');
    loginBox = q('#loginBox'); loginQr = q('#loginQr'); loginStatus = q('#loginStatus');
    loginOff = q('#loginOff'); loginDone = q('#loginDone'); loginFace = q('#loginFace'); loginName = q('#loginName');
    pQuick = q('#pQuick');
    bPrev.innerHTML = I.prev; bNext.innerHTML = I.next; bCfg.innerHTML = I.cfg;
    bVol.innerHTML = I.vol; pClose.innerHTML = I.close;
    bVol.addEventListener('click', () => volPop.classList.toggle('open'));

    bPlay.addEventListener('click', togglePlay);
    bNext.addEventListener('click', () => { if (isEngine) nextTrack(); else if (hbLive()) sendCmd('next'); });
    bPrev.addEventListener('click', () => { if (isEngine) prevTrack(); else if (hbLive()) sendCmd('prev'); });
    bMode.addEventListener('click', () => {
      const order = ['seq', 'shf', 'one'];
      cfg.mode = order[(order.indexOf(cfg.mode) + 1) % 3];
      S.set(K.cfg, cfg);
      renderAll();
      toast({ seq: '顺序播放', shf: '随机播放', one: '单曲循环' }[cfg.mode]);
    });
    coverImg.addEventListener('click', () => coverTap());
    // 点击标题 → 新标签页打开原视频（引擎读本地曲目，遥控端用心跳携带的 bvid）
    titleEl.addEventListener('click', () => {
      const v = view();
      const bv = v.bvid || (tracks[v.idx] && tracks[v.idx].bvid) || ((v.title || '').match(/BV[0-9A-Za-z]{10}/) || [])[0];
      if (bv) window.open('https://www.bilibili.com/video/' + bv, '_blank');
      else toast('当前没有可跳转的视频');
    });
    card.addEventListener('dblclick', e => {
      if (e.target.closest('button,input,textarea')) return;
      cfg.mini = !cfg.mini;
      card.classList.toggle('mini', cfg.mini);
      S.set(K.cfg, cfg);
      if (cfg.mini) { closePanel(); snapMini(); }   // 缩小：收起设置界面并滑向最近屏边
      else placeCard();                              // 放大：恢复全尺寸记忆位置
    });
    bCfg.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
    pClose.addEventListener('click', closePanel);

    bar.addEventListener('input', () => {
      barDragging = true;
      const f = bar.value / 1000;
      bar.style.setProperty('--p', f * 100 + '%');
      tcur.textContent = fmt(f * (view().dur || 0));
    });
    bar.addEventListener('change', () => {
      barDragging = false;
      const f = bar.value / 1000;
      if (isEngine) { if (audio && cur.dur) { try { audio.currentTime = f * cur.dur; } catch (e) {} } }
      else if (hbLive()) sendCmd('seek', f);
    });
    volEl.addEventListener('input', () => {
      const v = volEl.value / 100;
      cfg.vol = v;
      S.set(K.cfg, cfg);
      volEl.style.setProperty('--p', volEl.value + '%');
      const bVol2 = volEl.parentNode.querySelector('button');
      bVol2.innerHTML = v === 0 ? I.volMute : I.vol;
      if (isEngine && audio) audio.volume = v;
    });

    pAdd.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = pAdd.value.trim();
      if (!v) return;
      const valid = v.split(/\s+/).filter(s => parseId(s) || /b23\.tv/.test(s));
      if (!valid.length) { toast('无法识别的链接'); return; }
      pAdd.value = '';
      addUrls(valid, '已添加 ' + valid.length + ' 个视频');
    });
    pBlur.addEventListener('input', () => {
      cfg.blur = +pBlur.value;
      pBlurV.textContent = cfg.blur;
      applyStyle();
      clearTimeout(blurT);
      blurT = setTimeout(() => S.set(K.cfg, cfg), 350);
    });
    pOp.addEventListener('input', () => {
      cfg.opacity = +pOp.value / 100;
      pOpV.textContent = pOp.value;
      applyStyle();
      clearTimeout(opT);
      opT = setTimeout(() => S.set(K.cfg, cfg), 350);
    });
    pVol.addEventListener('input', () => {
      cfg.vol = +pVol.value / 100;
      pVolV.textContent = pVol.value;
      S.set(K.cfg, cfg);
      if (isEngine && audio) audio.volume = cfg.vol;
    });
    q('#loginSkip').addEventListener('click', () => { cfg.loginSkip = true; S.set(K.cfg, cfg); renderLoginUI(); });
    q('#loginOn').addEventListener('click', () => { cfg.loginSkip = false; S.set(K.cfg, cfg); renderLoginUI(); });
    q('#loginOut').addEventListener('click', logout);
    updVolDot = attachValueDot(volEl, v => v + '%');
    updVolPDot = attachValueDot(pVol, v => v + '%');
    updBlurDot = attachValueDot(pBlur, v => String(v));
    updOpDot = attachValueDot(pOp, v => v + '%');

    // 拖动（pointer capture 会把 click 重定向到卡片，故封面点击在 pointerup 里模拟）
    let drag = null, followPending = false;
    card.addEventListener('pointerdown', e => {
      if (!e.target.closest('#volWrap')) volPop.classList.remove('open');
      // #title 排除出拖拽捕获：否则指针捕获会把 click 重定向到卡片，标题点击跳转失效
      if (e.button !== 0 || e.target.closest('button,input,textarea,#title')) return;
      card.classList.remove('glide');   // 拖拽必须 1:1 跟手，掐掉贴边滑动动画
      drag = { x: e.clientX, y: e.clientY, l: card.offsetLeft, t: card.offsetTop, moved: false, onCover: !!e.target.closest('#cover') };
      card.classList.add('dragging');
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      card.style.left = clamp(drag.l + dx, 8, innerWidth - card.offsetWidth - 8) + 'px';
      card.style.top = clamp(drag.t + dy, 8, Math.max(8, innerHeight - card.offsetHeight - 8)) + 'px';
      if (!panel.hidden && !followPending) {   // 设置界面实时跟随卡片
        followPending = true;
        requestAnimationFrame(() => { followPending = false; if (!panel.hidden) positionPanel(); });
      }
    });
    const endDrag = () => { drag = null; card.classList.remove('dragging'); };
    card.addEventListener('pointerup', () => {
      if (!drag) return;
      if (!drag.moved && drag.onCover) coverTap();
      else if (drag.moved) {
        // 迷你态位置独立记忆（cfg.mx/my），不覆盖全尺寸卡片的位置（cfg.x/y）
        if (cfg.mini) { cfg.mx = card.offsetLeft; cfg.my = card.offsetTop; }
        else { cfg.x = card.offsetLeft; cfg.y = card.offsetTop; }
        S.set(K.cfg, cfg);
      }
      endDrag();
    });
    card.addEventListener('pointercancel', endDrag);

    placeCard();
    applyStyle();
    renderAll();
    uiReady = true;   // UI 就绪，此后渲染函数正常工作
  }

  function placeCard() {
    card.classList.toggle('mini', cfg.mini);   // 先同步迷你态再测量，位置记忆与尺寸才对得上
    card.classList.remove('glide');
    const sx = cfg.mini ? cfg.mx : cfg.x, sy = cfg.mini ? cfg.my : cfg.y;
    if (sx == null) {
      card.style.left = Math.max(8, innerWidth - card.offsetWidth - 28) + 'px';
      card.style.top = Math.max(8, innerHeight - card.offsetHeight - 28) + 'px';
    } else {
      card.style.left = clamp(sx, 8, Math.max(8, innerWidth - card.offsetWidth - 8)) + 'px';
      card.style.top = clamp(sy, 8, Math.max(8, innerHeight - card.offsetHeight - 8)) + 'px';
    }
  }

  // 双击缩小：滑向最近屏边（边距 12px），迷你位置独立记忆 cfg.mx/my，不覆盖全尺寸 cfg.x/y
  function snapMini() {
    const m = 12, w = card.offsetWidth, h = card.offsetHeight;
    const cx = card.offsetLeft + w / 2, cy = card.offsetTop + h / 2;
    const k = [cx, innerWidth - cx, cy, innerHeight - cy].indexOf(Math.min(cx, innerWidth - cx, cy, innerHeight - cy));
    let x = clamp(card.offsetLeft, m, Math.max(m, innerWidth - w - m));
    let y = clamp(card.offsetTop, m, Math.max(m, innerHeight - h - m));
    if (k === 0) x = m; else if (k === 1) x = innerWidth - w - m;
    else if (k === 2) y = m; else y = innerHeight - h - m;
    card.classList.add('glide');
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    cfg.mx = x; cfg.my = y;
    S.set(K.cfg, cfg);
    setTimeout(() => card.classList.remove('glide'), 260);
  }

  function applyStyle() {
    // 模糊与玻璃不透明度同时作用于卡片、设置面板、放大列表窗
    for (const el of [card, panel, bigPanel]) {
      if (!el) continue;
      el.style.setProperty('--bmc-blur', cfg.blur + 'px');
      el.style.setProperty('--op', String(cfg.opacity));
    }
    card.classList.toggle('mini', cfg.mini);
  }

  function renderAll() {
    if (!uiReady) return;
    const v = view();
    titleEl.textContent = v.title == null || v.title === '' ? 'Bilibili 音乐卡片' : v.title;
    titleEl.title = titleEl.textContent;
    if (v.cover !== lastCoverSet) {
      lastCoverSet = v.cover;
      const c = safeImg(v.cover) || FALLBACK;
      coverImg.src = c;
      bgImg.src = c;
    }
    const playIcon = v.playing ? I.pause : I.play;
    if (bPlay.innerHTML !== playIcon) bPlay.innerHTML = playIcon;
    bPlay.title = v.playing ? '暂停' : '播放';
    const MODE_META = {
      seq: [I.seq, '顺序播放（点击切换随机）'],
      shf: [I.shuffle, '随机播放（点击切换单曲循环）'],
      one: [I.one, '单曲循环（点击切换顺序）']
    };
    const mm = MODE_META[cfg.mode] || MODE_META.seq;
    if (bMode.innerHTML !== mm[0]) bMode.innerHTML = mm[0];
    bMode.title = mm[1];
    bMode.classList.toggle('active', cfg.mode !== 'seq');
    volEl.value = Math.round(cfg.vol * 100);
    volEl.style.setProperty('--p', volEl.value + '%');
    const volIconWant = cfg.vol === 0 ? I.volMute : I.vol;
    if (bVol.innerHTML !== volIconWant) bVol.innerHTML = volIconWant;
    if (updVolDot) updVolDot();
    updateMediaSessionMeta();
    updatePlayingRowHighlight();
    tdur.textContent = fmt(v.dur);
    renderTick();
  }

  let lastPlayingU = -1;
  // 当前播放行高亮：值变化时增量切换 class，不重建列表
  function updatePlayingRowHighlight() {
    if (!uiReady) return;
    if (panel.hidden && bigPanel.hidden) return;
    const v = view();
    const u = v.idx >= 0 && tracks[v.idx] ? tracks[v.idx].uIdx : -1;
    if (u === lastPlayingU) return;
    lastPlayingU = u;
    for (const c of [pList, bigList]) {
      if (!c) continue;
      c.querySelectorAll('.row').forEach(row => row.classList.toggle('playing', Number(row.dataset.u) === u));
    }
  }

  function renderTick() {
    if (!uiReady) return;
    const v = view();
    if (!barDragging) {
      const pct = v.dur ? v.pos / v.dur * 100 : 0;
      bar.value = Math.round(v.dur ? v.pos / v.dur * 1000 : 0);
      bar.style.setProperty('--p', pct + '%');
    }
    if (!isEngine || !barDragging) tcur.textContent = fmt(v.pos);
    tdur.textContent = fmt(v.dur);
  }

  // ---------------- 页面快捷添加（B 站视频页 / 收藏夹页） ----------------
  const ctxUrl = () => (typeof window.__BMC_TEST_LOC__ === 'string' && window.__BMC_TEST_LOC__) ? window.__BMC_TEST_LOC__ : location.href;

  function addUrls(list, label) {
    if (!list.length) { toast('没有可添加的内容'); return; }
    const seen = new Set(cfg.urls);
    const fresh = list.filter(u => !seen.has(u) && (seen.add(u), true));
    if (!fresh.length) { toast('这些视频已在播放列表中'); return; }
    cfg.urls = fresh.concat(cfg.urls);   // 新视频插入列表顶部
    S.set(K.cfg, cfg);
    lastUrls = cfg.urls.slice();
    fresh.forEach(u => recordAdded(u));   // 记录入库时间（按添加排序用）
    pruneAddedAt(cfg.urls);
    fresh.forEach((u, k) => glowMap.set(k, Date.now()));   // 顶部新条目的发光强调
    rebuildTracks();
    prefetchAll();
    updateHint();
    renderList();
    if (uiReady) {
      pList.scrollTop = 0;                                // 滚动到顶部预览新添加的视频
      if (!bigPanel.hidden) bigList.scrollTop = 0;
    }
    toast(label || `已添加 ${fresh.length} 个视频`);
  }

  function addFav(fid, btn) {
    btn.disabled = true;
    const orig = btn.textContent;
    const out = []; let pn = 1;
    const finish = () => { btn.disabled = false; btn.textContent = orig; };
    const step = () => gmJSON('https://api.bilibili.com/x/v3/fav/resource/list', { media_id: fid, pn, ps: 20, order: 'mtime', type: 0 }, (d, err) => {
      if (err || !d || d.code !== 0 || !d.data) { toast('收藏夹读取失败：' + (err || apiMsg(d))); return finish(); }
      const total = Math.min((d.data.info && d.data.info.total) || 0, 200);
      const medias = d.data.medias || [];
      medias.forEach(m => { if (m.bvid) out.push('https://www.bilibili.com/video/' + m.bvid); });
      if (!medias.length || out.length >= total) { addUrls(out, `已添加收藏夹 ${out.length} 个视频`); return finish(); }
      btn.textContent = `读取中 ${out.length}/${total}…`;
      pn++; setTimeout(step, 350);
    }, { auth: true });
    step();
  }

  function renderQuick() {
    if (!uiReady) return;
    const u = ctxUrl();
    const acts = [];
    const bv = u.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
    if (bv) acts.push(['＋ 添加当前视频', () => addUrls(['https://www.bilibili.com/video/' + bv[1]], '已添加当前视频')]);
    const fav = u.match(/bilibili\.com\/[^?#]*favlist[^?#]*\?[^#]*?fid=(\d+)/);
    if (fav) acts.push(['＋ 添加整个收藏夹', e => addFav(fav[1], e.currentTarget)]);
    pQuick.hidden = !acts.length;
    pQuick.innerHTML = '';
    acts.forEach(([label, fn]) => {
      const el = document.createElement('button');
      el.className = 'lgbtn';
      el.textContent = label;
      el.addEventListener('click', fn);
      pQuick.appendChild(el);
    });
  }

  function clearAll() {
    pushUndo();
    cfg.urls = [];
    S.set(K.cfg, cfg);
    lastUrls = [];
    glowMap.clear();
    sel.clear();
    if (isEngine && audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {} }
    cur.idx = -1; cur.pos = 0; cur.dur = 0; cur.playing = false; cur.title = ''; cur.cover = '';
    S.del(K.streams);
    rebuildTracks();
    updateHint();
    renderList();
    toast('播放列表已清空');
  }

  function openBig() {
    bigSearch.value = '';   // 打开时清空过滤，显示完整列表
    bigPanel.hidden = false;
    renderList();
  }

  // ---------------- 分享码导出/导入（BMC1. 前缀 + UTF-8 安全 Base64） ----------------
  function encodeShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'BMC1.' + btoa(bin);
  }
  function decodeShare(code) {
    try {
      const b64 = code.trim().replace(/^BMC1\./, '').replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      return obj && Array.isArray(obj.urls) ? obj.urls.filter(u => typeof u === 'string' && u.trim()) : null;
    } catch (e) { return null; }
  }
  function exportPlaylist() {
    if (!cfg.urls.length) { toast('播放列表为空'); return; }
    const code = encodeShare({ v: 1, urls: cfg.urls });
    const done = ok => {
      bigExport.textContent = ok ? '已复制到剪贴板' : '复制失败';
      setTimeout(() => { bigExport.textContent = '导出'; }, 2200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => done(true)).catch(() => done(false));
    else {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove(); done(ok);
    }
  }
  function importShare() {
    const raw = impText.value.trim();
    if (!raw) { toast('请先粘贴分享码'); return; }
    const urls = decodeShare(raw);
    if (!urls || !urls.length) { toast('分享码无效'); return; }
    impBox.hidden = true; impText.value = '';
    addUrls(urls, `已导入 ${urls.length} 个视频`);
  }

  function reorderUrl(from, to) {
    if (from === to || from < 0 || to < 0 || from >= cfg.urls.length || to > cfg.urls.length) return;
    const urls = cfg.urls.slice();
    const moved = urls.splice(from, 1)[0];
    urls.splice(to, 0, moved);
    cfg.urls = urls;
    S.set(K.cfg, cfg);
    rebuildTracks();
    updateHint();
    renderList();
  }

  // ---------------- 撤销栈与批量操作 ----------------
  function pushUndo() {
    undoStack.push(cfg.urls.slice());
    if (undoStack.length > 30) undoStack.shift();
  }
  function undoBatch() {
    const prev = undoStack.pop();
    if (!prev) { toast('没有可撤销的操作'); return; }
    cfg.urls = prev;
    S.set(K.cfg, cfg);
    lastUrls = cfg.urls.slice();
    sel.clear();
    rebuildTracks();
    updateHint();
    renderList();
    toast('已撤销');
  }

  function recordAdded(url) {
    const m = S.get(K.addedAt, {});
    m[url] = Date.now();
    const ks = Object.keys(m);
    if (ks.length > 500) { ks.sort((a, b) => (m[a] || 0) - (m[b] || 0)).slice(0, ks.length - 500).forEach(k => delete m[k]); }
    S.set(K.addedAt, m);
  }
  function pruneAddedAt(urls) {   // 列表变化后清理已不存在的记录
    const m = S.get(K.addedAt, {});
    const keep = new Set(urls);
    Object.keys(m).forEach(k => { if (!keep.has(k)) delete m[k]; });
    S.set(K.addedAt, m);
  }
  function addedTs(url) { const m = S.get(K.addedAt, {}); return m[url] || 0; }

  function trackDurOf(url) {
    const meta = S.get(K.meta, {});
    const t = Object.keys(meta).find(k => url.includes(k));
    if (t && meta[t] && meta[t].pages && meta[t].pages[0]) return meta[t].pages[0].dur || Infinity;
    return Infinity;
  }
  function trackTitleOf(url) {
    const meta = S.get(K.meta, {});
    const t = Object.keys(meta).find(k => url.includes(k));
    return t ? (meta[t].title || '') : url;
  }

  function batchRemove(idxs) {
    if (!idxs.length) { toast('未选择任何视频'); return; }
    pushUndo();
    cfg.urls = cfg.urls.filter((u, i) => !idxs.includes(i));
    sel.clear();
    afterListMutation(`已移除 ${idxs.length} 个视频`);
  }
  function batchEdge(idxs, toTop) {
    if (!idxs.length) { toast('未选择任何视频'); return; }
    pushUndo();
    const order = idxs.slice().sort((a, b) => a - b);
    const block = order.map(i => cfg.urls[i]);
    const rest = cfg.urls.filter((u, i) => !idxs.includes(i));
    cfg.urls = toTop ? block.concat(rest) : rest.concat(block);
    sel.clear();
    afterListMutation(toTop ? '已置顶所选' : '已置底所选');
  }

  function afterListMutation(msg) {
    S.set(K.cfg, cfg);
    lastUrls = cfg.urls.slice();
    pruneAddedAt(cfg.urls);
    rebuildTracks();
    updateHint();
    renderList();
    toast(msg);
  }

  function removeUrl(i) {
    pushUndo();
    const urls = cfg.urls.slice();
    urls.splice(i, 1);
    cfg.urls = urls;
    S.set(K.cfg, cfg);
    rebuildTracks();
    updateHint();
    renderList();
  }

  function clearRowMarks() {
    for (const c of [pList, bigList]) c.querySelectorAll('.row').forEach(x => x.classList.remove('dtop', 'dbottom'));
  }

  // 构建单行（面板与放大窗口共用）：点击播放、↑↓ 微调、拖拽排序、✕ 移除
  function rowTitleInfo(i) {
    const u = cfg.urls[i];
    const group = tracks.filter(x => x.uIdx === i);
    const t0 = group[0];
    if (t0 && t0.bad) return { cls: 't', text: '✕ 无效链接' };
    if (t0 && t0.pending) return { cls: 't wait', text: '解析中…' };
    if (t0) return { cls: 't', text: t0.title + (t0.sub ? ' · ' + t0.sub : '') + (group.length > 1 ? ` 等${group.length}P` : '') };
    return { cls: 't wait', text: u.length > 46 ? u.slice(0, 46) + '…' : u };
  }

  function makeRow(i, big) {
    const u = cfg.urls[i];
    const manage = big && manageMode;
    const row = document.createElement('div');
    row.className = 'row' + (manage ? ' vrow' : '');
    row.draggable = true;
    row.dataset.u = i;
    const playU = view().idx >= 0 && tracks[view().idx] ? tracks[view().idx].uIdx : -1;
    if (i === playU) row.classList.add('playing');
    if (manage && sel.has(i)) row.classList.add('msel');
    const n = document.createElement('span');
    n.className = 'n'; n.textContent = manage && sel.has(i) ? '\u2713' : (i + 1) + '.';
    const t = document.createElement('span');
    const info = rowTitleInfo(i);
    t.className = info.cls; t.textContent = info.text;
    const bvInUrl = u.match(/BV[0-9A-Za-z]{10}/);
    row.title = info.text + (bvInUrl ? ' · ' + bvInUrl[0] : '');
    if (glowMap.has(i) && Date.now() - glowMap.get(i) < 2000) t.classList.add('glow'); // 新加入视频的发光强调
    const up = document.createElement('button');
    up.className = 'op'; up.innerHTML = I.up; up.title = '上移';
    up.addEventListener('click', e => { e.stopPropagation(); reorderUrl(i, i - 1); });
    const dn = document.createElement('button');
    dn.className = 'op'; dn.innerHTML = I.dn; dn.title = '下移';
    dn.addEventListener('click', e => { e.stopPropagation(); reorderUrl(i, i + 1); });
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕'; rm.title = '移除';
    rm.addEventListener('click', e => { e.stopPropagation(); removeUrl(i); });
    row.addEventListener('dragstart', e => {
      dragFrom = i;
      row.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} }
    });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); clearRowMarks(); dragFrom = -1; });
    row.addEventListener('dragover', e => {
      if (dragFrom < 0) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const r = row.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      row.classList.toggle('dtop', before);
      row.classList.toggle('dbottom', !before);
    });
    row.addEventListener('dragleave', () => row.classList.remove('dtop', 'dbottom'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('dtop', 'dbottom');
      if (dragFrom < 0) return;
      const r = row.getBoundingClientRect();
      const target = (e.clientY < r.top + r.height / 2) ? i : i + 1;
      reorderUrl(dragFrom, dragFrom < target ? target - 1 : target);
    });
    row.append(n, t, up, dn, rm);
    row.addEventListener('click', () => {
      if (manage) { toggleSel(i); return; }
      if (isEngine) {
        const idx = tracks.findIndex(x => x.uIdx === i && !x.bad);
        if (!big) closePanel();
        if (idx >= 0) playAt(idx, { autoplay: true });
      } else if (hbLive()) { sendCmd('playUrl', i); toast('已发送到播放引擎'); }
    });
    return row;
  }

  // 管理模式选中：切换后仅更新计数与列表（虚拟滚动下全量重建可见区，代价极小）
  function toggleSel(i) {
    if (sel.has(i)) sel.delete(i); else sel.add(i);
    if (!uiReady) return;
    mCount.textContent = '已选 ' + sel.size;
    renderList();
  }

  // 当前搜索匹配的索引集（管理模式的 全选/反选 作用域；无 UI 场景视为无过滤）
  function searchScope() {
    const q = ((bigSearch && bigSearch.value) || '').trim().toLowerCase();
    const out = [];
    cfg.urls.forEach((u, i) => {
      if (!q) { out.push(i); return; }
      const info = rowTitleInfo(i);
      if ((info.text + ' ' + u).toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }

  function applySort(m) {
    if (m === 'manual') { toast('手动顺序：拖动或 ↑↓ 调整'); return; }
    pushUndo();
    if (m === 'shuffle') {
      for (let i = cfg.urls.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cfg.urls[i], cfg.urls[j]] = [cfg.urls[j], cfg.urls[i]]; }
    } else {
      const key = m === 'title' ? trackTitleOf : m === 'dur' ? trackDurOf : addedTs;
      cfg.urls.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka === kb) return 0;
        if (ka === Infinity) return 1;
        if (kb === Infinity) return -1;
        if (m === 'dur') return ka - kb;                 // 数值升序
        if (m === 'added') return kb - ka;               // 数值降序（新→旧）
        return String(ka).localeCompare(String(kb), 'zh');
      });
    }
    afterListMutation(m === 'shuffle' ? '已随机打乱' : '已' + (SORTS.find(x => x[0] === m) || ['', ''])[1] + '排序');
  }

  function renderList() {
    if (!uiReady) return;
    if (panel.hidden && bigPanel.hidden) return;   // 面板或放大窗任一可见即需刷新
    for (const [k, ts] of glowMap) if (Date.now() - ts > 2200) glowMap.delete(k);
    if (!panel.hidden) {
      pList.innerHTML = '';
      const CAP = 50;   // 面板小窗上限：超长列表引导去放大窗（含虚拟滚动）
      const over = cfg.urls.length > CAP;
      cfg.urls.slice(0, over ? CAP : cfg.urls.length).forEach((u, i) => pList.appendChild(makeRow(i, false)));
      if (over) {
        const hint = document.createElement('div');
        hint.className = 'vhint';
        hint.textContent = `共 ${cfg.urls.length} 个 · 点击打开放大列表管理全部`;
        hint.addEventListener('click', openBig);
        pList.appendChild(hint);
      }
    }
    if (!bigPanel.hidden) renderBig();
    requestAnimationFrame(positionPanel); // 列表高度变化后重新定位，避免遮挡卡片
  }

  // ---------------- 放大窗虚拟滚动（千条级列表只渲染可见区） ----------------
  const ROW_H = 32, VBUF = 6;
  function visibleIdxs() { return searchScope(); }
  function renderBig() {
    const idxs = visibleIdxs();
    bigTitle.textContent = (bigSearch.value || '').trim()
      ? `播放列表（${idxs.length}/${cfg.urls.length}）`
      : (manageMode && sel.size ? `管理（已选 ${sel.size}/${cfg.urls.length}）` : `播放列表（${cfg.urls.length}）`);
    const inner = document.createElement('div');
    inner.className = 'vinner';
    inner.style.height = (idxs.length * ROW_H) + 'px';
    const st = bigList.scrollTop, vh = bigList.clientHeight || 400;
    const from = Math.max(0, Math.floor(st / ROW_H) - VBUF);
    const to = Math.min(idxs.length, Math.ceil((st + vh) / ROW_H) + VBUF);
    for (let k = from; k < to; k++) {
      const row = makeRow(idxs[k], true);
      row.classList.add('vrow');
      row.style.top = (k * ROW_H) + 'px';
      inner.appendChild(row);
    }
    if (!idxs.length) {
      const hint = document.createElement('div');
      hint.className = 'vhint';
      hint.textContent = '没有匹配的视频';
      inner.appendChild(hint);
    }
    bigList.innerHTML = '';
    bigList.appendChild(inner);
  }

  function positionPanel() {
    if (panel.hidden) return;
    const r = card.getBoundingClientRect();
    panel.style.left = clamp(r.left, 8, Math.max(8, innerWidth - panel.offsetWidth - 8)) + 'px';
    const below = r.bottom + 10;
    panel.style.top = (below + panel.offsetHeight < innerHeight - 8 ? below : Math.max(8, r.top - panel.offsetHeight - 10)) + 'px';
  }

  function coverTap() {
    if (cfg.mini) { cfg.mini = false; card.classList.remove('mini'); S.set(K.cfg, cfg); placeCard(); }
    else togglePlay();
  }

  function updateHint() {
    if (!uiReady) return;
    pHint.textContent = '回车添加 · 支持空格分隔批量粘贴 · 播放列表 ' + cfg.urls.length + ' 个';
  }

  function openPanel() {
    panel.hidden = false;
    pAdd.value = '';
    pBlur.value = cfg.blur;
    pBlurV.textContent = cfg.blur;
    if (updBlurDot) updBlurDot();
    pVol.value = Math.round(cfg.vol * 100);
    pVolV.textContent = pVol.value;
    if (updVolPDot) updVolPDot();
    pOp.value = Math.round(cfg.opacity * 100);
    pOpV.textContent = pOp.value;
    if (updOpDot) updOpDot();
    // 本地凭证过期检测（节流；失效自动清除并回到扫码界面）
    if (authGet() && !authVerifiedRecently()) checkAuth({ expiryToast: true });
    renderQuick();
    updateHint();
    renderList();
    renderLoginUI();
    requestAnimationFrame(positionPanel);
  }

  function closePanel() {
    panel.hidden = true;
    loginStop();
    if (!bigPinned) bigPanel.hidden = true;   // 默认随面板关闭；图钉钉住后保持打开
  }

  function toast(msg) {
    if (!uiReady) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }

  // ---------------- 全局监听 ----------------
  function watch() {
    // 本页视频播放检测（2s 轮询）：引擎暂停播放；遥控端发暂停指令给引擎。每次“新的视频播放”只打断一次
    setInterval(() => {
      const vidPlaying = [...document.querySelectorAll('video')]
        .some(v => v.readyState >= 2 && !v.paused && !v.ended && !v.muted);
      if (vidPlaying && !vidPlayingPrev) vidPauseArmed = true;   // 新一轮视频播放 → 重新武装
      vidPlayingPrev = vidPlaying;
      if (!vidPlaying || !vidPauseArmed) return;
      const shouldPause = (isEngine && cur.playing) || (!isEngine && hbState && hbState.play && hbState.play.playing);
      if (!shouldPause) return;
      vidPauseArmed = false;
      if (Date.now() - vidToastGate > 60000) {
        vidToastGate = Date.now();
        toast('检测到网页视频播放，已暂停');
      }
      if (isEngine) { if (audio) audio.pause(); }
      else sendCmd('pause');
    }, 2000);
    S.onChange(K.hb, (nv, remote) => {
      if (!remote || !nv || !nv.id) return;
      if (isEngine) { if (nv.id !== MYID && nv.id > MYID) demote('另一引擎在线'); return; }
      hbState = nv; hbRcAt = Date.now();
      renderAll();
    });
    S.onChange(K.cfg, (nv, remote) => {
      if (!remote || !nv) return;
      cfg = normalizeCfg(nv);
      applyStyle();
      if (JSON.stringify(cfg.urls) !== JSON.stringify(lastUrls)) {
        lastUrls = cfg.urls.slice();
        rebuildTracks();
        if (isEngine) prefetchAll();
      }
      if (isEngine && audio) audio.volume = cfg.vol;
      renderAll();
    });
    S.onChange(K.meta, (nv, remote) => { if (remote) rebuildTracks(); });
    S.onChange(K.cmd, (nv, remote) => {
      if (!remote || !nv || nv.from === MYID || nv.seq === lastCmdSeq) return;
      lastCmdSeq = nv.seq;
      if (isEngine) handleCmd(nv);
    });
    // 引擎缺席检测（兜底轮询，同时兼容无 GM_addValueChangeListener 的环境）
    setInterval(() => {
      if (isEngine) return;
      const hb = S.get(K.hb);
      if (hb && hb.ts && Date.now() - hb.ts < STALE_MS) {
        hbState = hb; hbRcAt = hb.ts;
        return;
      }
      hbState = hb || null; hbRcAt = hb && hb.ts ? hb.ts : 0;
      if (hbState && hbState.play && hbState.play.playing) tryClaim(true); // 引擎掉线但本应在播
    }, 4000);
    // 遥控端进度插值
    setInterval(() => {
      if (isEngine || !hbState || !hbState.play || !hbState.play.playing) return;
      hbState.play.pos = Math.min((hbState.play.pos || 0) + 0.5, hbState.play.dur || 1e9);
      renderTick();
    }, 500);
    addEventListener('resize', () => placeCard());
    addEventListener('pagehide', () => {
      if (!isEngine) return;
      if (cur.idx >= 0 && tracks[cur.idx] && tracks[cur.idx].key && audio) saveTrackPos(tracks[cur.idx].key, audio.currentTime, audio.duration);
      pushHB();
    });
  }

  // ---------------- 启动 ----------------
  // 页面限定：仅 B 站相关页面运行（直播页除外），其他页面不启动
  function isBiliPage(href) {
    try {
      const h = new URL(href || location.href).hostname;
      if (h === 'live.bilibili.com' || h.endsWith('.live.bilibili.com')) return false;   // 直播及分区除外
      return h === 'bilibili.com' || h.endsWith('.bilibili.com');
    } catch (e) { return false; }
  }

  function boot() {
    // 默认策略：仅 B 站相关页面运行，其他页面不启动（油猴菜单保留临时启动逃生口）
    if (cfg.confine && !isBiliPage() && !(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bmc.force'))) {
      if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('在此页面运行音乐卡片（临时）', () => { sessionStorage.setItem('bmc.force', '1'); location.reload(); });
      console.log('[BMC] 非B站页面，插件未启动');
      return;
    }
    buildUI();
    watch();
    startWebFsWatch();
    rebuildTracks();
    const hb = S.get(K.hb);
    if (hb && hb.id && Date.now() - hb.ts < STALE_MS) becomeRemote();
    else tryClaim(true);
    if (authGet()) checkAuth();   // 启动时优先使用本地凭证，静默校验是否过期
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开播放列表 / 设置', openPanel);
      GM_registerMenuCommand('扫码登录 B 站', openPanel);
    }
    if (!cfg.urls.length && !S.get(K.seen)) { S.set(K.seen, 1); openPanel(); }
  }

  if (typeof document !== 'undefined' && typeof document.getElementById === 'function') boot();
})();
