/* SlimQuest - お腹の定点撮影と変化ビュー
 *
 * 体重は水分で1〜2kg動くので、見た目の変化のほうが正直な記録になる。
 * ただし「同じ位置・同じ距離・同じ明るさ」で撮れていないと比較にならないので、
 * カメラのプレビューに
 *   ・十字線(縦=体の中心、横=おへその高さ)
 *   ・ガイド枠(体を合わせる目安。はば・高さ・横線の位置を調整でき、設定は次回も残る)
 *   ・前回の写真の半透明オーバーレイ(輪郭を重ねる)
 * を出して、前回と同じ構図に合わせてから撮れるようにしている。
 * 枠を固定サイズにすると体型・撮る距離に合わず邪魔になるだけなので、必ず調整可能にすること。
 *
 * 保存は長辺1280px・JPEG品質0.8(1枚150〜300KB)。毎日撮っても半年で50MB前後に収まる。
 * カメラが使えない端末・環境では「写真を選ぶ」(ファイル選択)にフォールバックする。
 */
'use strict';

const Belly = {
  MAX_SIDE: 1280,
  QUALITY: 0.8,
  GUIDE_KEY: 'sq_belly_guide',
  FACING_KEY: 'sq_belly_facing',
  GUIDE_DEFAULT: { w: 50, h: 60, y: 50 },

  _stream: null,
  _facing: '',    // 'environment'(外側) / 'user'(内側)
  _list: [],      // 日付の古い順
  _idx: 0,
  _playT: null,
  _urls: [],      // createObjectURL したもの(画面を離れるとき解放する)

  /* ---------- データ ---------- */

  async load() {
    const all = await DB.getAll('photos');
    this._list = all.sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
    return this._list;
  },

  all() { return this._list; },
  latest() { return this._list.length ? this._list[this._list.length - 1] : null; },

  _url(rec) {
    if (!rec || !rec.blob || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    const u = URL.createObjectURL(rec.blob);
    this._urls.push(u);
    return u;
  },

  _freeUrls() {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      this._urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) { /* 解放済み */ } });
    }
    this._urls = [];
  },

  /** 長辺を MAX_SIDE に収める縮小サイズ(元が小さいときは拡大しない) */
  fitSize(w, h) {
    const long = Math.max(w, h);
    if (!long) return { w: 0, h: 0 };
    const s = long > this.MAX_SIDE ? this.MAX_SIDE / long : 1;
    return { w: Math.round(w * s), h: Math.round(h * s) };
  },

  /** video / img を縮小して JPEG の Blob にする */
  _toBlob(source, w, h) {
    const size = this.fitSize(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext('2d').drawImage(source, 0, 0, size.w, size.h);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, w: size.w, h: size.h });
        else reject(new Error('画像を作れませんでした'));
      }, 'image/jpeg', this.QUALITY);
    });
  },

  async savePhoto(blob, w, h) {
    const rec = { date: Calc.today(), blob, w, h };
    rec.id = await DB.add('photos', rec);
    this._list.push(rec);
    this._list.sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
    if (this._list.length >= 10) Streak.unlock('photo10');
    return rec;
  },

  async removePhoto(id) {
    await DB.del('photos', Number(id));
    this._list = this._list.filter((x) => x.id !== Number(id));
  },

  /* ---------- ガイド枠 ---------- */

  /** 保存してある枠の設定(はば% / 高さ% / 横線の高さ%) */
  guide() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(this.GUIDE_KEY) || 'null'); }
    catch (_) { g = null; }
    return Object.assign({}, this.GUIDE_DEFAULT, g || {});
  },

  /** スライダーの値を画面に反映して保存する */
  applyGuide(save) {
    const num = (id, def) => {
      const el = document.getElementById(id);
      const v = Number(el && el.value);
      return Number.isFinite(v) && v > 0 ? v : def;
    };
    const d = this.GUIDE_DEFAULT;
    const g = { w: num('bl-gw', d.w), h: num('bl-gh', d.h), y: num('bl-gy', d.y) };
    const box = document.getElementById('bl-guide');
    if (box) {
      box.style.width = `${g.w}%`;
      box.style.height = `${g.h}%`;
      box.style.top = `${g.y}%`;
    }
    const line = document.getElementById('bl-cy');
    if (line) line.style.top = `${g.y}%`;
    if (save !== false) localStorage.setItem(this.GUIDE_KEY, JSON.stringify(g));
    return g;
  },

  /** 保存した設定をスライダーに戻して反映する */
  loadGuide() {
    const g = this.guide();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
    set('bl-gw', g.w);
    set('bl-gh', g.h);
    set('bl-gy', g.y);
    this.applyGuide(false);
    return g;
  },

  resetGuide() {
    localStorage.removeItem(this.GUIDE_KEY);
    this.loadGuide();
    showToast('ガイド枠を元に戻しました');
  },

  toggleGuidePanel() {
    document.getElementById('bl-guide-panel').classList.toggle('hidden');
  },

  /* ---------- 撮影画面 ---------- */

  /** showScreen('belly') から呼ばれる */
  async onShow() {
    await this.load();
    this.renderGhost();
    this.loadGuide();
    this.setStatus('');
    this._facing = localStorage.getItem(this.FACING_KEY) || 'environment';
    await this.startCamera();
  },

  /** 現在の向き(this._facing)でカメラを開く */
  async startCamera() {
    const video = document.getElementById('bl-video');
    this.updateFlipButton();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setStatus('この端末ではカメラを直接使えません。「保存済みの写真から選ぶ」で記録できます。', true);
      if (video) video.classList.add('hidden');
      return false;
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this._facing }, width: { ideal: 1280 } },
        audio: false
      });
      video.classList.remove('hidden');
      video.srcObject = this._stream;
      await video.play();
      this.setStatus(this.latest()
        ? '前回の写真に重ねて、縦線に体の中心・横線におへそを合わせてください'
        : '縦線に体の中心、横線におへそが来るように立って撮ってください。次回からこの写真に重ねられます');
      return true;
    } catch (err) {
      this.setStatus(`カメラを使えませんでした: ${err.message}。「保存済みの写真から選ぶ」でも記録できます。`, true);
      video.classList.add('hidden');
      return false;
    }
  },

  /**
   * 外側(背面)と内側(前面)を切り替える。選んだ向きは次回も覚えている。
   * 左右反転(ミラー)はしない。プレビューと保存される写真がずれると、
   * 前回写真との重ね合わせが成立しなくなるため。
   */
  async switchCamera() {
    this._facing = this._facing === 'user' ? 'environment' : 'user';
    localStorage.setItem(this.FACING_KEY, this._facing);
    this.stop();
    this.setStatus('カメラを切り替えています...');
    const ok = await this.startCamera();
    if (!ok) {
      // 片方しかカメラがない端末では元に戻す
      this._facing = this._facing === 'user' ? 'environment' : 'user';
      localStorage.setItem(this.FACING_KEY, this._facing);
      await this.startCamera();
      showToast('このカメラは使えませんでした');
    }
  },

  updateFlipButton() {
    const el = document.getElementById('bl-facing');
    if (el) el.textContent = this._facing === 'user' ? '内' : '外';
  },

  /** 画面を離れるときに必ず呼ぶ(カメラを掴んだままにしない) */
  stop() {
    if (this._playT) { clearInterval(this._playT); this._playT = null; }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    const video = document.getElementById('bl-video');
    if (video) video.srcObject = null;
  },

  setStatus(msg, isWarn) {
    const el = document.getElementById('bl-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('warn-text', !!isWarn);
  },

  /** 前回の写真をプレビューに半透明で重ねる */
  renderGhost() {
    const img = document.getElementById('bl-ghost');
    if (!img) return;
    this._freeUrls();
    const last = this.latest();
    if (!last) { img.classList.add('hidden'); img.removeAttribute('src'); return; }
    img.src = this._url(last);
    img.classList.remove('hidden');
    this.setGhostOpacity();
  },

  setGhostOpacity() {
    const r = document.getElementById('bl-opacity');
    const img = document.getElementById('bl-ghost');
    if (r && img) img.style.opacity = String((Number(r.value) || 0) / 100);
  },

  async shoot() {
    const video = document.getElementById('bl-video');
    if (!this._stream || !video || video.readyState < 2) {
      appAlert('カメラの準備ができていません。「写真を選ぶ」からでも記録できます。');
      return;
    }
    try {
      const r = await this._toBlob(video, video.videoWidth, video.videoHeight);
      await this.savePhoto(r.blob, r.w, r.h);
      this.renderGhost();
      showToast(`${Calc.fmtShort(Calc.today())} の写真を保存しました(全${this._list.length}枚)`);
    } catch (err) {
      this.setStatus(`保存できませんでした: ${err.message}`, true);
    }
  },

  /** ファイル選択からの取り込み(カメラが使えない端末のフォールバック) */
  async fromFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('画像を読み込めませんでした'));
        im.src = url;
      });
      const r = await this._toBlob(img, img.naturalWidth, img.naturalHeight);
      await this.savePhoto(r.blob, r.w, r.h);
      this.renderGhost();
      showToast(`写真を保存しました(全${this._list.length}枚)`);
    } catch (err) {
      this.setStatus(`保存できませんでした: ${err.message}`, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /* ---------- 変化ビュー ---------- */

  async onShowView() {
    await this.load();
    this._idx = Math.max(0, this._list.length - 1);
    this.renderView();
  },

  renderView() {
    this._freeUrls();
    const img = document.getElementById('bv-img');
    const cap = document.getElementById('bv-caption');
    const slider = document.getElementById('bv-slider');
    const empty = document.getElementById('bv-empty');

    if (!this._list.length) {
      empty.classList.remove('hidden');
      img.classList.add('hidden');
      img.removeAttribute('src');
      slider.disabled = true;
      cap.textContent = '';
      return;
    }
    empty.classList.add('hidden');
    img.classList.remove('hidden');
    slider.disabled = false;
    slider.min = '0';
    slider.max = String(this._list.length - 1);
    slider.value = String(this._idx);

    const rec = this._list[this._idx];
    img.src = this._url(rec);
    cap.innerHTML = this.caption(rec);
  },

  /** 日付・何枚目か・その日の体重(なければ直前の記録)を出す */
  caption(rec) {
    const n = this._idx + 1;
    const first = this._list[0];
    const days = first ? Calc.diffDays(first.date, rec.date) : 0;
    const w = this.weightOn(rec.date);
    const w0 = first ? this.weightOn(first.date) : null;
    const diff = (w !== null && w0 !== null) ? Calc.r1(w - w0) : null;
    return `<b>${escapeHtml(Calc.fmtShort(rec.date))}</b>` +
      ` <small>${n}/${this._list.length}枚目 · 1枚目から${days}日</small>` +
      (w !== null ? `<br>体重 ${w} kg${diff !== null && diff !== 0
        ? `(1枚目から ${diff > 0 ? '+' : ''}${diff} kg)` : ''}` : '');
  },

  /** その日以前でいちばん新しい体重の記録 */
  weightOn(date) {
    const list = Weight.all().filter((w) => w.date <= date);
    return list.length ? list[list.length - 1].weight : null;
  },

  seek(i) {
    const n = Number(i);
    if (!this._list.length) return;
    this._idx = Math.max(0, Math.min(this._list.length - 1, n));
    this.renderView();
  },

  /** パラパラ再生。もう一度押すと止まる */
  togglePlay() {
    const btn = document.getElementById('btn-bv-play');
    if (this._playT) {
      clearInterval(this._playT);
      this._playT = null;
      btn.textContent = '▶ 再生';
      return;
    }
    if (this._list.length < 2) { appAlert('写真が2枚以上あると再生できます'); return; }
    this._idx = 0;
    this.renderView();
    btn.textContent = '⏸ 停止';
    this._playT = setInterval(() => {
      if (this._idx >= this._list.length - 1) {
        clearInterval(this._playT);
        this._playT = null;
        btn.textContent = '▶ 再生';
        return;
      }
      this._idx += 1;
      this.renderView();
    }, 450);
  },

  async removeCurrent() {
    const rec = this._list[this._idx];
    if (!rec) return;
    if (!await appConfirm(`${Calc.fmtShort(rec.date)} の写真を削除します。取り消せません。`, '写真の削除')) return;
    await this.removePhoto(rec.id);
    this._idx = Math.max(0, Math.min(this._idx, this._list.length - 1));
    this.renderView();
    showToast('削除しました');
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Belly };
