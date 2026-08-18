/* SlimQuest - バックアップ / 復元
 *
 * MiniZip : 依存ライブラリなしの最小ZIP(無圧縮)書き出し・読み込み。ConfQuest から流用
 * Backup  : localStorage の sq_* + IndexedDB の全ストア + お腹の写真 を1ファイルにまとめる
 *
 * 方針(ConfQuest と同じ):
 *  ・バックアップは「普通のZIP」にする。エクスプローラーで開けば slimquest-backup.json と
 *    photos/ が見えるので、中身が確認できて安心できる
 *  ・写真は既にJPEGで圧縮済みなので無圧縮(store)で十分。JSONも高々数百KB
 *  ・APIキーは既定で入れない(ファイルを他人に渡す可能性があるため)。チェックで入れられる
 *
 * 大事な判断: **写真を含まないバックアップから復元しても、端末の写真は消さない。**
 * 「軽いバックアップ」で気軽に取ったものを復元したときに、撮りためた写真が消えるのが
 * いちばん取り返しがつかないため。写真を含むバックアップのときだけ写真を置き換える。
 */
'use strict';

/* ==================== 最小ZIP ==================== */
const MiniZip = {
  _crc: null,

  crcTable() {
    if (this._crc) return this._crc;
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    this._crc = t;
    return t;
  },

  crc32(u8) {
    const t = this.crcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  },

  dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xFFFF;
  },
  dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  },

  /**
   * entries: [{ name, data: Uint8Array | Blob }] → ZIPのBlob
   * 写真Blobは1件ずつしかメモリに展開しない(CRC計算後は元のBlobを使う)。
   */
  async write(entries, now) {
    const stamp = now || new Date();
    const time = this.dosTime(stamp);
    const date = this.dosDate(stamp);
    const enc = new TextEncoder();
    const body = [];      // ローカルヘッダ+データ
    const central = [];   // 中央ディレクトリ
    let offset = 0;
    let cdSize = 0;

    for (const e of entries) {
      const isBytes = e.data instanceof Uint8Array;
      const u8 = isBytes ? e.data : new Uint8Array(await e.data.arrayBuffer());
      const size = u8.length;
      const crc = this.crc32(u8);
      const name = enc.encode(e.name);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);        // version needed
      lh.setUint16(6, 0x0800, true);    // UTF-8 filename
      lh.setUint16(8, 0, true);         // method = store
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      // データ本体はBlobのまま渡す(たくさんの写真をメモリに残さない)
      body.push(new Uint8Array(lh.buffer), name, isBytes ? u8 : e.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);        // version made by
      cd.setUint16(6, 20, true);        // version needed
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);        // extra
      cd.setUint16(32, 0, true);        // comment
      cd.setUint16(34, 0, true);        // disk
      cd.setUint16(36, 0, true);        // internal attrs
      cd.setUint32(38, 0, true);        // external attrs
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + size;
      cdSize += 46 + name.length;
    }

    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(4, 0, true);
    eo.setUint16(6, 0, true);
    eo.setUint16(8, entries.length, true);
    eo.setUint16(10, entries.length, true);
    eo.setUint32(12, cdSize, true);
    eo.setUint32(16, offset, true);
    eo.setUint16(20, 0, true);

    return new Blob(body.concat(central, [new Uint8Array(eo.buffer)]),
      { type: 'application/zip' });
  },

  /** ZIPのBlob → [{name, blob}]。中央ディレクトリだけ読むので大きくても軽い */
  async read(blob) {
    const size = blob.size;
    if (size < 22) throw new Error('ファイルが小さすぎます。バックアップファイルではないようです。');
    const tailLen = Math.min(size, 66000);
    const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    let p = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { p = i; break; }
    }
    if (p < 0) throw new Error('ZIPとして読めませんでした。SlimQuestのバックアップファイルを選んでください。');
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const count = tv.getUint16(p + 10, true);
    const cdSize = tv.getUint32(p + 12, true);
    const cdOff = tv.getUint32(p + 16, true);

    const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const dec = new TextDecoder();
    const heads = [];
    let q = 0;
    for (let i = 0; i < count; i++) {
      if (q + 46 > cd.length || cv.getUint32(q, true) !== 0x02014b50) break;
      const nl = cv.getUint16(q + 28, true);
      const xl = cv.getUint16(q + 30, true);
      const cl = cv.getUint16(q + 32, true);
      heads.push({
        name: dec.decode(cd.subarray(q + 46, q + 46 + nl)),
        method: cv.getUint16(q + 10, true),
        compSize: cv.getUint32(q + 20, true),
        lho: cv.getUint32(q + 42, true)
      });
      q += 46 + nl + xl + cl;
    }

    const out = [];
    for (const h of heads) {
      const lv = new DataView(await blob.slice(h.lho, h.lho + 30).arrayBuffer());
      if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('ZIPの構造が壊れています。');
      const start = h.lho + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
      let part = blob.slice(start, start + h.compSize);
      if (h.method === 8) {
        // 他のツールで作り直された場合(deflate)にも一応対応する
        if (typeof DecompressionStream === 'undefined') {
          throw new Error(`圧縮されたZIPには対応していません (${h.name})。SlimQuestが作ったファイルをそのままお使いください。`);
        }
        part = await new Response(part.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      } else if (h.method !== 0) {
        throw new Error(`未対応の圧縮方式です (${h.name})。`);
      }
      out.push({ name: h.name, blob: part });
    }
    return out;
  }
};

/* ==================== バックアップ本体 ==================== */

const Backup = {
  FORMAT: 'slimquest-backup',
  FORMAT_VERSION: 1,
  META_NAME: 'slimquest-backup.json',
  LAST_KEY: 'sq_last_backup',
  SECRET_KEYS: ['sq_ai_key'],
  /** 写真以外の全ストア。JSONにそのまま入れる(どれも小さい) */
  STORES: ['menus', 'meals', 'weights', 'exercises', 'shopping', 'pantry', 'ingWords'],

  /* ---------- 小さな純関数(テストしやすい単位) ---------- */

  fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  },

  /** ファイル名: slimquest-backup_2026-08-18_full.zip(full=写真あり / light=写真なし) */
  fileName(withPhotos, now) {
    const d = now || new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    return `slimquest-backup_${day}_${withPhotos ? 'full' : 'light'}.zip`;
  },

  /** バックアップ対象の localStorage(sq_ で始まるものすべて)を集める */
  collectLocal(includeKeys, store) {
    const ls = store || localStorage;
    const out = {};
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || k.indexOf('sq_') !== 0) continue;
      if (!includeKeys && this.SECRET_KEYS.indexOf(k) >= 0) continue;
      out[k] = ls.getItem(k);
    }
    return out;
  },

  /** メタ情報 → 確認ダイアログ用の人間向けサマリー(純関数) */
  summarize(meta) {
    const S = (meta && meta.stores) || {};
    const n = (k) => (Array.isArray(S[k]) ? S[k].length : 0);
    const photos = (meta && meta.photos) || [];
    const bytes = photos.reduce((s, p) => s + (p.bytes || 0), 0);
    const d = meta && meta.createdAt ? new Date(meta.createdAt) : null;
    const p2 = (x) => String(x).padStart(2, '0');
    const when = d && !isNaN(d.getTime())
      ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
      : '不明';

    const meals = Array.isArray(S.meals) ? S.meals : [];
    const days = new Set(meals.map((m) => m.date)).size;
    const weights = Array.isArray(S.weights) ? S.weights : [];
    const last = weights.length
      ? weights.map((w) => w.weight).slice(-1)[0]
      : null;

    return [
      `作成日時: ${when}`,
      `アプリ版: v${(meta && meta.appVersion) || '?'}`,
      `🍽️ 食事の記録: ${n('meals')}件(${days}日ぶん)`,
      `⚖️ 体重の記録: ${n('weights')}件${last !== null ? ` (最後は ${last}kg)` : ''}`,
      `🏃 運動の記録: ${n('exercises')}件`,
      `📋 登録したメニュー: ${n('menus')}件`,
      `🥬 手持ち食材: ${n('pantry')}件 / 🛒 買い物リスト: ${n('shopping')}件`,
      `📸 お腹の写真: ${photos.length ? `${photos.length}枚 (${this.fmtBytes(bytes)})` : '含まれていません'}`,
      `🔑 APIキー: ${meta && meta.includeKeys ? '含まれています' : '含まれていません'}`
    ];
  },

  /** 最後にバックアップした日時の表示文(純関数) */
  lastBackupText(iso, now) {
    if (!iso) return '⚠ まだ一度もバックアップしていません。';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '⚠ まだ一度もバックアップしていません。';
    const base = now || new Date();
    const days = Math.floor((base - d) / 86400000);
    const day = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const ago = days <= 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`;
    const warn = days >= 14 ? ' ⚠ そろそろ取り直しをおすすめします。' : '';
    return `最後のバックアップ: ${day} (${ago})${warn}`;
  },

  lastBackupAt() { return localStorage.getItem(this.LAST_KEY) || ''; },

  /** 実際に保存できたときだけ呼ぶ(作っただけでは「バックアップ済み」にしない) */
  markSaved(now) {
    localStorage.setItem(this.LAST_KEY, (now || new Date()).toISOString());
  },

  readme(meta) {
    return [
      'SlimQuest バックアップファイル',
      '',
      `作成日時 : ${meta.createdAt}`,
      `アプリ版 : v${meta.appVersion}`,
      `写真     : ${meta.includePhotos ? `含む (${(meta.photos || []).length}枚)` : '含まない'}`,
      `APIキー  : ${meta.includeKeys ? '含む(このファイルは他の人と共有しないでください)' : '含まない'}`,
      '',
      '【復元のしかた】',
      '1. SlimQuest を開く (https://rafysta.github.io/slimquest/)',
      '2. ⚙設定 → 「バックアップと復元」 → 「⬆ バックアップから復元」',
      '3. このZIPファイルを選ぶ',
      '',
      '※ このファイルは展開しないでください。ZIPのまま選んでください。',
      '※ slimquest-backup.json に記録と設定、photos/ にお腹の写真が入っています。',
      '※ 写真を含まないバックアップから復元しても、端末に入っている写真は消えません。'
    ].join('\n');
  },

  /* ---------- 作成 ---------- */

  /**
   * options: { photos, keys, onProgress(text) }
   * 戻り値: { blob, name, meta, bytes }
   */
  async create(options) {
    const opt = options || {};
    const say = opt.onProgress || function () {};
    const now = new Date();
    const meta = {
      format: this.FORMAT,
      formatVersion: this.FORMAT_VERSION,
      appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?',
      createdAt: now.toISOString(),
      includePhotos: !!opt.photos,
      includeKeys: !!opt.keys,
      localStorage: this.collectLocal(!!opt.keys),
      stores: {},
      photos: []
    };

    say('記録を集めています…');
    for (const s of this.STORES) {
      try { meta.stores[s] = await DB.getAll(s); }
      catch (_) { meta.stores[s] = []; }
    }

    const files = [];
    if (opt.photos) {
      say('お腹の写真を集めています…');
      try {
        const list = (await DB.getAll('photos'))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
        let i = 0;
        for (const p of list) {
          if (!p.blob || !p.blob.size) continue;
          const path = `photos/${String(++i).padStart(4, '0')}.jpg`;
          meta.photos.push({
            path, id: p.id, date: p.date, w: p.w || 0, h: p.h || 0,
            type: p.blob.type || 'image/jpeg', bytes: p.blob.size
          });
          files.push({ name: path, data: p.blob });
        }
      } catch (_) { /* 写真が1枚もない端末 */ }
    }

    say('ファイルにまとめています…');
    const enc = new TextEncoder();
    const entries = [
      { name: this.META_NAME, data: enc.encode(JSON.stringify(meta)) },
      { name: 'README.txt', data: enc.encode(this.readme(meta)) }
    ].concat(files);

    const blob = await MiniZip.write(entries, now);
    return { blob, name: this.fileName(!!opt.photos, now), meta, bytes: blob.size };
  },

  /* ---------- 中身の確認 ---------- */

  /** ZIPを読んで {meta, entries} を返す(まだ書き込まない) */
  async inspect(file) {
    const entries = await MiniZip.read(file);
    const metaEntry = entries.find((e) => e.name === this.META_NAME);
    if (!metaEntry) {
      throw new Error('SlimQuestのバックアップファイルではないようです(slimquest-backup.json が見つかりません)。');
    }
    let meta;
    try { meta = JSON.parse(await metaEntry.blob.text()); }
    catch (_) { throw new Error('バックアップの中身が壊れています。'); }
    if (meta.format !== this.FORMAT) throw new Error('SlimQuestのバックアップファイルではないようです。');
    if (meta.formatVersion > this.FORMAT_VERSION) {
      throw new Error(`このバックアップは新しい形式(v${meta.formatVersion})です。先にアプリを更新してください。`);
    }
    return { meta, entries };
  },

  /* ---------- 復元 ---------- */

  /**
   * inspect() の結果を渡して復元する。options: { keys, onProgress(text) }
   * 記録は「バックアップの状態にまるごと置き換える」(ほかの端末と同じ状態にするため)。
   * ただし写真だけは、バックアップに入っていないときは触らない(消えると取り返しがつかない)。
   */
  async restore(inspected, options) {
    const opt = options || {};
    const say = opt.onProgress || function () {};
    const meta = inspected.meta;
    const byPath = {};
    inspected.entries.forEach((e) => { byPath[e.name] = e.blob; });

    say('設定を書き戻しています…');
    const keepSecrets = {};
    this.SECRET_KEYS.forEach((k) => { keepSecrets[k] = localStorage.getItem(k); });

    const old = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('sq_') === 0) old.push(k);
    }
    old.forEach((k) => localStorage.removeItem(k));

    const L = meta.localStorage || {};
    Object.keys(L).forEach((k) => {
      if (!opt.keys && this.SECRET_KEYS.indexOf(k) >= 0) return;
      localStorage.setItem(k, L[k]);
    });
    // APIキーを復元しない(または入っていない)ときは、今の端末のキーを残す
    this.SECRET_KEYS.forEach((k) => {
      if (!localStorage.getItem(k) && keepSecrets[k]) localStorage.setItem(k, keepSecrets[k]);
    });

    const stats = { keys: Object.keys(L).length, stores: {}, photos: 0, missing: 0, photosKept: false };

    say('記録を書き戻しています…');
    const S = meta.stores || {};
    for (const s of this.STORES) {
      const rows = Array.isArray(S[s]) ? S[s] : [];
      await DB.clear(s);
      await DB.putAll(s, rows);
      stats.stores[s] = rows.length;
    }

    const photos = meta.photos || [];
    if (photos.length) {
      say('お腹の写真を書き戻しています…');
      const rows = [];
      for (const p of photos) {
        const b = byPath[p.path];
        if (!b) { stats.missing++; continue; }
        rows.push({
          id: p.id, date: p.date, w: p.w || 0, h: p.h || 0,
          blob: new Blob([b], { type: p.type || 'image/jpeg' })
        });
      }
      await DB.clear('photos');
      await DB.putAll('photos', rows);
      stats.photos = rows.length;
    } else {
      // 写真なしのバックアップ。端末に残っている写真はそのままにする
      stats.photosKept = true;
    }

    return stats;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { MiniZip, Backup };
