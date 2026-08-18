/* SlimQuest - バーコード読み取り(市販品の登録を速くする)
 *
 * 照会は4段階。上から順に試し、見つかった時点で止める:
 *   ① menus の jan 一致  … 一度登録した商品は通信なしで即ヒット(これが本命)
 *   ② Open Food Facts   … 公開データベース。日本の商品は収録が薄いので空でも静かに次へ
 *   ③ AI の Web検索      … JANコードで検索させる(APIキーがあるときだけ)
 *   ④ 手入力            … パッケージの成分表示を見て入れる
 * どの経路でも結果は menus に jan 付きで保存され、次回からは①で即ヒットする。
 *
 * 読み取りには Android Chrome 標準の BarcodeDetector を使う(外部ライブラリなし)。
 * 非対応の端末では番号の手入力にフォールバックするので、機能自体は使える。
 */
'use strict';

const Barcode = {
  _stream: null,
  _timer: null,
  _det: null,
  _busy: false,

  supported() {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window;
  },

  /* ---------- 画面 ---------- */

  async open() {
    showScreen('barcode');
    this.setStatus('');
    document.getElementById('bc-manual-row').classList.add('hidden');
    if (!this.supported()) {
      this.setStatus('この端末はカメラでのバーコード読み取りに対応していません。番号を手で入力してください。', true);
      this.showManual();
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.setStatus(`カメラを使えませんでした: ${err.message}`, true);
      this.showManual();
    }
  },

  async start() {
    const video = document.getElementById('bc-video');
    this.setStatus('カメラを準備しています...');
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = this._stream;
    await video.play();

    // 端末が対応している形式だけを指定する(未対応形式を混ぜると生成で失敗する)
    let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    try {
      const ok = await window.BarcodeDetector.getSupportedFormats();
      const filtered = formats.filter((f) => ok.includes(f));
      if (filtered.length) formats = filtered;
    } catch (_) { /* 取得できなくても既定のまま試す */ }

    this._det = new window.BarcodeDetector({ formats });
    this.setStatus('商品のバーコードを枠に入れてください');
    this._timer = setInterval(() => this.tick(), 300);
  },

  async tick() {
    if (this._busy || !this._det) return;
    const video = document.getElementById('bc-video');
    if (!video || video.readyState < 2) return;
    this._busy = true;
    try {
      const found = await this._det.detect(video);
      if (found && found.length && found[0].rawValue) {
        const code = String(found[0].rawValue).replace(/\D/g, '');
        if (code.length >= 8) {
          this.stop();
          await this.lookup(code);
        }
      }
    } catch (_) { /* 1フレーム失敗しても次のフレームで拾えばよい */ }
    this._busy = false;
  },

  /** 画面を離れるとき・読み取れたときに必ず呼ぶ(カメラを掴んだままにしない) */
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    const video = document.getElementById('bc-video');
    if (video) video.srcObject = null;
    this._busy = false;
  },

  setStatus(msg, isWarn) {
    const el = document.getElementById('bc-status');
    el.textContent = msg;
    el.classList.toggle('warn-text', !!isWarn);
  },

  showManual() {
    const row = document.getElementById('bc-manual-row');
    row.classList.remove('hidden');
    document.getElementById('bc-manual-input').focus();
  },

  manualLookup() {
    const v = document.getElementById('bc-manual-input').value.replace(/\D/g, '');
    if (v.length < 8) { appAlert('バーコードの番号(8桁以上)を入力してください'); return; }
    this.stop();
    this.lookup(v);
  },

  /* ---------- 照会 ---------- */

  async lookup(code) {
    this.setStatus(`${code} を調べています...`);

    // ① 登録済み(通信なし・即時)
    const known = Menus.all().find((m) => String(m.jan || '') === code);
    if (known) {
      showScreen('meal-add');
      Meals.openAmount(known.id);
      showToast(`${known.name}(登録済み)`);
      return;
    }

    // ② Open Food Facts
    let hit = null;
    try {
      hit = await this.offLookup(code);
    } catch (_) { /* 通信できなくても③へ進む */ }

    // ③ AI の Web検索
    if (!hit && AI.hasKey()) {
      this.setStatus(`${code} をWebで検索しています...`);
      try {
        const r = await AI.searchByBarcode(code);
        if (r.candidates && r.candidates.length) hit = r.candidates[0];
      } catch (err) {
        this.setStatus(`検索に失敗しました: ${err.message}`, true);
      }
    }

    // ④ 手入力(見つからなくても名前欄を空で開くだけ)
    if (hit) {
      Meals.openNew({
        name: hit.name, base: hit.base || '100g',
        kcal: hit.kcal, p: hit.p, f: hit.f, c: hit.c,
        jan: code, origin: hit.origin || 'barcode'
      });
      showToast(`${hit.name} が見つかりました。確認して登録してください`);
    } else {
      Meals.openNew({ name: '', base: '1個', jan: code, origin: 'barcode' });
      showToast('見つかりませんでした。パッケージを見て入力してください');
    }
  },

  /**
   * Open Food Facts の照会。100gあたりの値が返るので基準量は 100g にする。
   * 収録がない/カロリーが空の商品は null を返し、静かに次の手段へ進む。
   */
  async offLookup(code) {
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json` +
      '?fields=product_name,product_name_ja,brands,quantity,nutriments';
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.status !== 1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments || {};
    const kcal = Number(n['energy-kcal_100g']);
    if (!kcal || kcal <= 0) return null;
    const name = (p.product_name_ja || p.product_name || '').trim();
    if (!name) return null;
    return {
      name: p.brands ? `${name}(${String(p.brands).split(',')[0].trim()})` : name,
      base: '100g',
      kcal: Math.round(kcal),
      p: Calc.r1(n.proteins_100g),
      f: Calc.r1(n.fat_100g),
      c: Calc.r1(n.carbohydrates_100g),
      origin: 'off'
    };
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Barcode };
