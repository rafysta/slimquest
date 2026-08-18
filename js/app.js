/* SlimQuest - アプリ本体(画面遷移・プロフィール・ホーム・設定)
 * 依存する全モジュールを使うため、最後に読み込むこと。
 */
'use strict';

/* ---------- エラーの可視化(真っ白な画面の原因を出す) ---------- */
function showErrorBanner(msg) {
  let el = document.getElementById('error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-banner';
    el.innerHTML = '<div id="error-banner-msgs"></div><button id="error-banner-close">×</button>';
    document.body.appendChild(el);
    el.querySelector('#error-banner-close').addEventListener('click', () => el.remove());
  }
  const p = document.createElement('p');
  p.textContent = '⚠ ' + msg;
  el.querySelector('#error-banner-msgs').appendChild(p);
}
window.addEventListener('error', (e) => {
  showErrorBanner((e.message || 'エラー') + ' @' +
    String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
});
window.addEventListener('unhandledrejection', (e) => {
  showErrorBanner('Promise: ' + String((e.reason && e.reason.message) || e.reason));
});
if (window.__earlyErrors && window.__earlyErrors.length) {
  window.__earlyErrors.forEach((m) => showErrorBanner(m));
}

/* ---------- 共通UI ---------- */

function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** ブラウザ標準の alert / confirm は使わない(タイトルが消せずアプリらしくないため) */
function appDialog(msg, title, isConfirm) {
  return new Promise((resolve) => {
    const ov = document.getElementById('modal-overlay');
    document.getElementById('modal-title').textContent = title || '';
    document.getElementById('modal-msg').textContent = msg;
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
    cancel.style.display = isConfirm ? '' : 'none';
    const close = (r) => { ov.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(r); };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    ov.classList.remove('hidden');
  });
}
function appAlert(msg, title) { return appDialog(msg, title, false); }
function appConfirm(msg, title) { return appDialog(msg, title, true); }

function showToast(msg) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- プロフィール ---------- */

const Profile = {
  DEFAULT: {
    height: 173,
    birthYear: 1985,
    birthMonth: 1,
    sex: 'male',
    startWeight: 81,
    startDate: '2026-08-17',
    goalWeight: 60,
    goalDate: '2027-01-31',
    commute: { on: false, minutes: 40 }
  },

  get() {
    let p;
    try { p = JSON.parse(localStorage.getItem('sq_profile') || 'null'); }
    catch (_) { p = null; }
    return Object.assign({}, this.DEFAULT, p || {});
  },

  save(p) {
    localStorage.setItem('sq_profile', JSON.stringify(Object.assign(this.get(), p)));
  },

  isSet() { return !!localStorage.getItem('sq_profile'); },

  autoCommute() { return this.get().commute; },

  /** 今日の基礎消費(運動を除く) */
  baseBurn() {
    const p = this.get();
    const w = Weight.current();
    const age = Calc.age(p.birthYear, p.birthMonth);
    return Calc.baseBurn(Calc.bmr(w, p.height, age, p.sex));
  },

  /** 今日の目標摂取カロリー = 基礎消費 + 運動 - 目標赤字 */
  targetIntake(burnedByExercise) {
    const p = this.get();
    const deficit = Calc.targetDeficit(Weight.current(), p.goalWeight, Calc.today(), p.goalDate);
    return Math.max(1200, this.baseBurn() + (burnedByExercise || 0) - deficit);
  }
};

/* ---------- 画面遷移 ---------- */

function showScreen(name) {
  // カメラを掴んだままにしない(バーコード・撮影画面から離れたら必ず止める)
  if (name !== 'barcode' && typeof Barcode !== 'undefined') Barcode.stop();
  if (name !== 'belly' && typeof Belly !== 'undefined') Belly.stop();

  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (!el) { showErrorBanner(`画面 ${name} がありません`); return; }
  el.classList.add('active');
  window.scrollTo(0, 0);

  if (name === 'home') renderHome();
  if (name === 'meal-add') { Meals.renderSlotTabs(); Meals.renderList(); }
  if (name === 'meal-set') SetBuilder.render();
  if (name === 'recipe-edit') Recipes.render();
  if (name === 'diary') Meals.renderDiary();
  if (name === 'weight') Weight.render();
  if (name === 'exercise') Exercise.render();
  if (name === 'pantry') Pantry.render();
  if (name === 'suggest') Suggest.render();
  if (name === 'shopping') Shopping.render();
  if (name === 'belly') Belly.onShow();
  if (name === 'belly-view') Belly.onShowView();
  if (name === 'badges') Streak.render();
  if (name === 'menu-list') MenuList.render();
  if (name === 'settings') loadSettings();
  if (name === 'about') renderAbout();
}

/* ---------- ホーム ---------- */

async function renderHome() {
  const p = Profile.get();
  const today = Calc.today();

  // 結婚式までのカウントダウン
  const left = Calc.diffDays(today, p.goalDate);
  document.getElementById('countdown').innerHTML = left >= 0
    ? `目標日まで <b>${left}</b> 日`
    : '目標日を過ぎました';

  // 連続記録
  document.getElementById('streak-text').textContent = `連続 ${Streak.current()} 日`;

  // 今日の収支
  const [meals, burned] = await Promise.all([
    Meals.byDate(today),
    Exercise.burnedOn(today)
  ]);
  const t = Meals.totals(meals);
  const target = Profile.targetIntake(burned);
  const rest = target - t.kcal;
  const ratio = Math.max(0, Math.min(1.3, target ? t.kcal / target : 0));

  const R = 52, C = 2 * Math.PI * R;
  const dash = Math.min(1, ratio) * C;
  const over = ratio > 1;
  document.getElementById('ring').innerHTML = `
    <svg viewBox="0 0 130 130" class="ring-svg" xmlns="http://www.w3.org/2000/svg">
      <circle cx="65" cy="65" r="${R}" class="ring-bg"/>
      <circle cx="65" cy="65" r="${R}" class="ring-fg${over ? ' over' : ''}"
        stroke-dasharray="${dash.toFixed(1)} ${(C - dash).toFixed(1)}"
        transform="rotate(-90 65 65)"/>
      <text x="65" y="58" class="ring-num" text-anchor="middle">${Math.abs(rest)}</text>
      <text x="65" y="76" class="ring-lbl" text-anchor="middle">${rest >= 0 ? 'kcal のこり' : 'kcal オーバー'}</text>
    </svg>`;

  document.getElementById('balance-detail').innerHTML = `
    <div><span>摂取</span><b>${t.kcal}</b></div>
    <div><span>目安</span><b>${target}</b></div>
    <div><span>運動</span><b>${burned}</b></div>`;
  document.getElementById('pfc-line').textContent =
    `P ${t.p}g / F ${t.f}g / C ${t.c}g`;

  // 買い物リストに残りがあればホームのボタンに件数を出す
  const rest2 = Shopping.remaining();
  document.getElementById('home-shop').textContent = rest2 ? `買い物 ${rest2}` : '買い物';

  // 体重
  const cur = Weight.current();
  const lost = Calc.r1((p.startWeight || cur) - cur);
  document.getElementById('home-weight').innerHTML =
    `<b>${cur}</b> kg <small>${lost > 0 ? `開始から -${lost}kg` : lost < 0 ? `開始から +${Math.abs(lost)}kg` : '開始時と同じ'}</small>`;
}

/* ---------- 設定 ---------- */

function loadSettings() {
  const p = Profile.get();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('st-height', p.height);
  set('st-birth-year', p.birthYear);
  set('st-birth-month', p.birthMonth);
  set('st-sex', p.sex);
  set('st-start-weight', p.startWeight);
  set('st-start-date', p.startDate);
  set('st-goal-weight', p.goalWeight);
  set('st-goal-date', p.goalDate);
  set('st-commute-min', (p.commute && p.commute.minutes) || 40);
  document.getElementById('st-commute-on').checked = !!(p.commute && p.commute.on);
  set('st-ai-key', AI.getKey());
  renderSettingsInfo();
  updateBackupInfo();
}

function renderSettingsInfo() {
  const p = Profile.get();
  const w = Weight.current();
  const age = Calc.age(p.birthYear, p.birthMonth);
  const bmr = Calc.bmr(w, p.height, age, p.sex);
  const base = Calc.baseBurn(bmr);
  const def = Calc.targetDeficit(w, p.goalWeight, Calc.today(), p.goalDate);
  const pace = Calc.requiredPace(w, p.goalWeight, Calc.today(), p.goalDate);
  document.getElementById('st-info').innerHTML = `
    <p>年齢 ${age}歳 · 基礎代謝 約 ${bmr} kcal · 運動を除く1日の消費 約 ${base} kcal</p>
    <p>目標までに必要なペース 週 ${Calc.r1(pace)} kg → 1日の目標赤字 ${def} kcal
    ${def >= 600 ? '<br><span class="warn-text">※ 上限の600kcalで頭打ちにしています。無理のないペースを優先してください。</span>' : ''}</p>`;
}

function saveSettings() {
  const num = (id) => Number(document.getElementById(id).value);
  const p = {
    height: num('st-height'),
    birthYear: num('st-birth-year'),
    birthMonth: num('st-birth-month'),
    sex: document.getElementById('st-sex').value,
    startWeight: num('st-start-weight'),
    startDate: document.getElementById('st-start-date').value,
    goalWeight: num('st-goal-weight'),
    goalDate: document.getElementById('st-goal-date').value,
    commute: {
      on: document.getElementById('st-commute-on').checked,
      minutes: num('st-commute-min') || 40
    }
  };
  if (!p.height || !p.startWeight || !p.goalWeight) {
    appAlert('身長・体重・目標体重を入力してください');
    return false;
  }
  AI.setKey(document.getElementById('st-ai-key').value);
  Profile.save(p);
  renderSettingsInfo();
  showToast('設定を保存しました');
  return true;
}

/* ---------- 初回ウィザード ---------- */

function startWizard() {
  const p = Profile.DEFAULT;
  document.getElementById('wz-height').value = p.height;
  document.getElementById('wz-birth-year').value = p.birthYear;
  document.getElementById('wz-weight').value = '';
  document.getElementById('wz-goal-weight').value = p.goalWeight;
  document.getElementById('wz-goal-date').value = p.goalDate;
  showScreen('setup');
}

async function finishWizard() {
  const h = Number(document.getElementById('wz-height').value);
  const by = Number(document.getElementById('wz-birth-year').value);
  const w = Number(document.getElementById('wz-weight').value);
  const gw = Number(document.getElementById('wz-goal-weight').value);
  const gd = document.getElementById('wz-goal-date').value;
  const sex = document.getElementById('wz-sex').value;
  if (!h || !by || !w || !gw || !gd) {
    appAlert('すべての項目を入力してください');
    return;
  }
  Profile.save({
    height: h, birthYear: by, birthMonth: 1, sex,
    startWeight: w, startDate: Calc.today(),
    goalWeight: gw, goalDate: gd
  });
  await Weight.set(Calc.today(), w, 0);
  Streak.recordToday();
  showToast('設定しました。記録を始めましょう');
  showScreen('home');
}

/* ---------- アプリ情報 ---------- */

function renderAbout() {
  document.getElementById('ab-version').textContent = `v${APP_VERSION} (${APP_BUILD})`;
  document.getElementById('ab-changelog').innerHTML = CHANGELOG.map((c) => `
    <div class="cl">
      <h4>v${c.version} <small>${c.date}</small></h4>
      <p class="cl-title">${escapeHtml(c.title || '')}</p>
      <ul>${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`).join('');
}

/* ---------- 更新の仕組み ---------- */

async function fetchServerVersion() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`サーバーから取得できません (${res.status})`);
  return res.json();
}

async function purgeAll() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
}

function hardReload() {
  const base = location.href.split('?')[0].split('#')[0];
  location.replace(`${base}?v=${Date.now()}`);
}

/* ---------- 起動 ---------- */

/** セット/レシピ画面のボタンと検索欄をまとめて配線する(構造が同じなので共通化) */
function bindCombo(builder, openBtnId, newItemBtnId, saveRecordBtnId, saveBtnId) {
  const p = builder.cfg.prefix;
  document.getElementById(openBtnId).addEventListener('click', () => builder.openFresh());
  const search = document.getElementById(`${p}-search`);
  search.addEventListener('input', () => builder.renderResults());
  document.getElementById(`${p}-search-clear`).addEventListener('click', () => {
    search.value = ''; builder.renderResults(); search.focus();
  });
  document.getElementById(newItemBtnId).addEventListener('click', () => {
    Meals.openNew(search.value.trim(), builder);
  });
  document.getElementById(saveRecordBtnId).addEventListener('click', () => builder.save(true));
  document.getElementById(saveBtnId).addEventListener('click', () => builder.save(false));
}

/* ---------- バックアップ / 復元 ---------- */

function backupOptions() {
  return {
    photos: document.getElementById('bk-photos').checked,
    keys: document.getElementById('bk-keys').checked
  };
}

function updateBackupInfo() {
  const el = document.getElementById('backup-last');
  const text = Backup.lastBackupText(Backup.lastBackupAt());
  el.textContent = text;
  el.classList.toggle('warn-text', text.indexOf('⚠') >= 0);
}

function bindBackup() {
  const status = () => document.getElementById('backup-status');

  // ファイルを共有できる端末(主にAndroid)だけ「共有して保存」を出す
  const shareBtn = document.getElementById('btn-backup-share');
  if (navigator.canShare && navigator.share) shareBtn.classList.remove('hidden');

  document.getElementById('btn-backup-export').addEventListener('click', async () => {
    const btn = document.getElementById('btn-backup-export');
    const opt = backupOptions();

    /* 保存先を選ぶダイアログは「クリックした直後」しか開けない(ZIPを作ってから
     * 呼ぶと権限エラーになる)ので、作る前に先に聞く。PCのChrome/Edgeなら
     * Nextcloudの同期フォルダを直接選べるので、あとから移す手間がなくなる。 */
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          id: 'slimquest-backup',
          suggestedName: Backup.fileName(opt.photos),
          types: [{ description: 'SlimQuest バックアップ', accept: { 'application/zip': ['.zip'] } }]
        });
      } catch (err) {
        if (err && err.name === 'AbortError') { status().textContent = '保存をキャンセルしました。'; return; }
        handle = null;   // 使えない環境ならダウンロードで続行する
      }
    }

    btn.disabled = true;
    status().textContent = '準備しています…';
    try {
      const r = await Backup.create(Object.assign({}, opt, {
        onProgress: (t) => { status().textContent = t; }
      }));
      if (handle) {
        status().textContent = '書き込んでいます…';
        const w = await handle.createWritable();
        await w.write(r.blob);
        await w.close();
        status().textContent = `✓ 「${handle.name}」に保存しました(${Backup.fmtBytes(r.bytes)})。`;
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = r.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 20000);
        status().textContent = `✓ ${r.name}(${Backup.fmtBytes(r.bytes)})を保存しました。` +
          'ダウンロードフォルダにあるので、Nextcloud などに移しておいてください。';
      }
      Backup.markSaved();
      updateBackupInfo();
    } catch (err) {
      status().textContent = `⚠ バックアップを作成できませんでした: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  shareBtn.addEventListener('click', async () => {
    const opt = backupOptions();
    shareBtn.disabled = true;
    status().textContent = '準備しています…';
    try {
      const r = await Backup.create(Object.assign({}, opt, {
        onProgress: (t) => { status().textContent = t; }
      }));
      const file = new File([r.blob], r.name, { type: 'application/zip' });
      if (!navigator.canShare({ files: [file] })) {
        status().textContent = '⚠ この端末ではファイルを共有できません。「バックアップを作成」をお使いください。';
        return;
      }
      await navigator.share({ files: [file], title: r.name });
      // 共有シートでキャンセルされたかは分からないので、送った前提で記録する
      Backup.markSaved();
      updateBackupInfo();
      status().textContent = `✓ ${r.name}(${Backup.fmtBytes(r.bytes)})を共有しました。`;
    } catch (err) {
      if (err && err.name === 'AbortError') { status().textContent = '共有をキャンセルしました。'; return; }
      status().textContent = `⚠ 共有できませんでした: ${err.message}`;
    } finally {
      shareBtn.disabled = false;
    }
  });

  document.getElementById('btn-backup-import')
    .addEventListener('click', () => document.getElementById('backup-file').click());

  document.getElementById('backup-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';   // 同じファイルをもう一度選べるように
    if (!file) return;
    status().textContent = 'バックアップの中身を確認しています…';
    let insp;
    try {
      insp = await Backup.inspect(file);
    } catch (err) {
      status().textContent = `⚠ ${err.message}`;
      return;
    }
    const hasPhotos = (insp.meta.photos || []).length > 0;
    const ok = await appConfirm(
      `このバックアップの内容:\n\n${Backup.summarize(insp.meta).join('\n')}\n\n` +
      'この端末の記録と設定をすべて置き換えます。いまの状態は元に戻せません。\n' +
      (hasPhotos
        ? 'お腹の写真も置き換えられます。'
        : 'このバックアップに写真は入っていないので、この端末の写真はそのまま残ります。'),
      '⬆ バックアップから復元');
    if (!ok) { status().textContent = '復元をキャンセルしました。'; return; }

    status().textContent = '復元しています…';
    try {
      const st = await Backup.restore(insp, {
        keys: !!insp.meta.includeKeys,
        onProgress: (t) => { status().textContent = t; }
      });
      const s = st.stores || {};
      await appAlert(
        `復元しました。\n\n設定: ${st.keys}項目\n食事: ${s.meals || 0}件\n体重: ${s.weights || 0}件\n` +
        `運動: ${s.exercises || 0}件\nメニュー: ${s.menus || 0}件\n` +
        `写真: ${st.photosKept ? 'この端末のものをそのまま残しました' : `${st.photos}枚`}` +
        (st.missing ? `\n⚠ 見つからなかった写真: ${st.missing}件` : '') +
        '\n\nOKを押すとアプリを読み込み直します。',
        '✓ 復元完了');
      hardReload();
    } catch (err) {
      status().textContent = `⚠ 復元に失敗しました: ${err.message}`;
    }
  });
}

function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => showScreen(b.dataset.nav));
  });

  // 食事
  document.querySelectorAll('[data-addmeal]').forEach((b) => {
    b.addEventListener('click', () =>
      Meals.openAdd(b.dataset.addmeal || undefined, b.dataset.addmealFrom));
  });
  document.getElementById('ma-back').addEventListener('click', () => showScreen(Meals.backTo));
  const search = document.getElementById('meal-search');
  search.addEventListener('input', () => Meals.renderList());
  document.getElementById('btn-search-clear').addEventListener('click', () => {
    search.value = ''; Meals.renderList(); search.focus();
  });
  document.getElementById('btn-meal-new').addEventListener('click', () => {
    Meals.openNew(document.getElementById('meal-search').value.trim());
  });
  document.getElementById('btn-mn-save-record').addEventListener('click', () => Meals.saveNew(true));
  document.getElementById('btn-mn-save').addEventListener('click', () => Meals.saveNew(false));
  document.getElementById('mn-back').addEventListener('click', () => {
    const dest = Meals.editing ? 'menu-list'
      : Meals.newCombo ? Meals.newCombo.cfg.screen
        : 'meal-add';
    Meals.newCombo = null;
    Meals.editing = null;
    showScreen(dest);
  });
  document.getElementById('btn-mn-delete').addEventListener('click', () => Meals.deleteEditing());

  // メニューの整理
  const mlSearch = document.getElementById('ml-search');
  mlSearch.addEventListener('input', () => MenuList.render());
  document.getElementById('ml-search-clear').addEventListener('click', () => {
    mlSearch.value = ''; MenuList.render(); mlSearch.focus();
  });
  document.getElementById('btn-ai-search').addEventListener('click', () => AiUI.start());

  // セット作成 / レシピ登録(どちらも js/combo.js の共通部品)
  bindCombo(SetBuilder, 'btn-meal-set', 'btn-ms-new-item', 'btn-ms-save-record', 'btn-ms-save');
  bindCombo(Recipes, 'btn-meal-recipe', 'btn-rc-new-item', 'btn-rc-save-record', 'btn-rc-save');
  document.getElementById('rc-serves').addEventListener('input', () => Recipes.renderTotal());

  // バーコード
  document.getElementById('btn-meal-barcode').addEventListener('click', () => Barcode.open());
  document.getElementById('btn-bc-show-manual').addEventListener('click', () => Barcode.showManual());
  document.getElementById('btn-bc-manual').addEventListener('click', () => Barcode.manualLookup());

  // 手持ち食材
  const ptIn = document.getElementById('pt-input');
  ptIn.addEventListener('input', () => Pantry.renderSuggest());
  document.getElementById('pt-input-clear').addEventListener('click', () => {
    ptIn.value = ''; Pantry.renderSuggest(); ptIn.focus();
  });
  document.getElementById('btn-pt-add').addEventListener('click', () => Pantry.addTyped());
  document.getElementById('btn-pt-clear').addEventListener('click', async () => {
    if (!Pantry.count()) { appAlert('手持ち食材はまだ登録されていません'); return; }
    if (!await appConfirm('手持ち食材リストを空にします。', '手持ち食材')) return;
    await Pantry.clear();
    Pantry.render();
    showToast('空にしました');
  });

  // 買い物リスト
  const spIn = document.getElementById('sp-input');
  spIn.addEventListener('input', () => Shopping.renderSuggest());
  document.getElementById('sp-input-clear').addEventListener('click', () => {
    spIn.value = ''; Shopping.renderSuggest(); spIn.focus();
  });
  document.getElementById('btn-sp-add').addEventListener('click', () => Shopping.addTyped());
  document.getElementById('btn-sp-to-pantry').addEventListener('click', () => Shopping.onMoveToPantry());
  document.getElementById('btn-sp-clear-checked').addEventListener('click', () => Shopping.onClearChecked());

  // 献立の提案
  document.getElementById('btn-sg-run').addEventListener('click', () => Suggest.run());

  // お腹の定点撮影
  document.getElementById('bl-opacity').addEventListener('input', () => Belly.setGhostOpacity());
  document.getElementById('btn-bl-flip').addEventListener('click', () => Belly.switchCamera());
  document.getElementById('btn-bl-guide').addEventListener('click', () => Belly.toggleGuidePanel());
  document.getElementById('btn-bl-guide-reset').addEventListener('click', () => Belly.resetGuide());
  ['bl-gw', 'bl-gh', 'bl-gy'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => Belly.applyGuide());
  });
  document.getElementById('btn-bl-shoot').addEventListener('click', () => Belly.shoot());
  document.getElementById('bl-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    Belly.fromFile(f);
  });
  document.getElementById('bv-slider').addEventListener('input', (e) => Belly.seek(e.target.value));
  document.getElementById('btn-bv-play').addEventListener('click', () => Belly.togglePlay());
  document.getElementById('btn-bv-del').addEventListener('click', () => Belly.removeCurrent());

  // 量シート
  document.querySelectorAll('#as-quick [data-f]').forEach((b) => {
    b.addEventListener('click', () => Meals.setFactor(Number(b.dataset.f)));
  });
  document.getElementById('as-slider').addEventListener('input', (e) => Meals.setFactor(e.target.value));
  document.getElementById('as-ok').addEventListener('click', () => Meals.commitAmount());
  document.getElementById('as-cancel').addEventListener('click', () => Meals.closeAmount());

  // 日記
  document.getElementById('btn-diary-prev').addEventListener('click', () =>
    Meals.renderDiary(Calc.addDays(Meals.diaryDate, -1)));
  document.getElementById('btn-diary-next').addEventListener('click', () =>
    Meals.renderDiary(Calc.addDays(Meals.diaryDate, 1)));
  document.getElementById('btn-diary-today').addEventListener('click', () =>
    Meals.renderDiary(Calc.today()));
  document.getElementById('btn-diary-date').addEventListener('click', () => Meals.toggleCal());
  document.getElementById('btn-cal-prev').addEventListener('click', () =>
    Meals.renderCal(Meals.shiftMonth(Meals.calYm, -1)));
  document.getElementById('btn-cal-next').addEventListener('click', () =>
    Meals.renderCal(Meals.shiftMonth(Meals.calYm, 1)));

  // 体重
  document.getElementById('btn-w-save').addEventListener('click', () => Weight.save());
  document.querySelectorAll('#w-range [data-range]').forEach((b) => {
    b.addEventListener('click', () => { Weight.range = b.dataset.range; Weight.render(); });
  });

  // 運動
  document.getElementById('ex-min').addEventListener('input', () => Exercise.preview());
  document.getElementById('btn-ex-add').addEventListener('click', () => Exercise.commit());

  // 設定
  document.getElementById('btn-st-save').addEventListener('click', () => saveSettings());
  bindBackup();
  document.getElementById('btn-force-reset').addEventListener('click', async () => {
    if (!await appConfirm('キャッシュを消して再読み込みします。記録したデータは消えません。', '完全リセット')) return;
    await purgeAll();
    setTimeout(hardReload, 400);
  });
  document.getElementById('btn-wipe-data').addEventListener('click', async () => {
    if (!await appConfirm('食事・体重・運動の記録と設定をすべて削除します。取り消せません。', 'データを全消去')) return;
    await Promise.all(['menus', 'meals', 'weights', 'exercises', 'photos', 'shopping', 'pantry', 'ingWords']
      .map((s) => DB.clear(s)));
    // APIキー以外の sq_* をすべて消す(キーごとに列挙すると消し忘れが出るため)
    const keep = AI.getKey();
    const del = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('sq_') === 0) del.push(k);
    }
    del.forEach((k) => localStorage.removeItem(k));
    if (keep) AI.setKey(keep);
    showToast('すべて削除しました');
    setTimeout(hardReload, 600);
  });
  document.getElementById('btn-check-update').addEventListener('click', async () => {
    const st = document.getElementById('update-status');
    st.textContent = 'サーバーに問い合わせ中...';
    try {
      const info = await fetchServerVersion();
      if (info.version === APP_VERSION) { st.textContent = '✓ すでに最新版です'; return; }
      st.textContent = `新しいバージョン v${info.version} を取得しています...`;
      await purgeAll();
      setTimeout(hardReload, 400);
    } catch (err) {
      st.textContent = `⚠ ${err.message}`;
    }
  });

  // ウィザード
  document.getElementById('btn-wz-done').addEventListener('click', () => finishWizard());
}

async function boot() {
  bindEvents();
  document.getElementById('version-footer').textContent = `SlimQuest v${APP_VERSION}`;

  try {
    await Menus.load();
    await Weight.load();
    // 手持ち食材・買い物・食材辞書は小さいので起動時に読む(写真は開いたときだけ読む)
    await Promise.all([Pantry.load(), Shopping.load(), IngWords.load()]);
  } catch (err) {
    showErrorBanner('データベースを開けませんでした: ' + err.message);
  }

  Meals.slot = Meals.slotByHour();
  Meals.diaryDate = Calc.today();
  Meals.targetDate = Calc.today();

  if (!Profile.isSet()) {
    startWizard();
  } else {
    try { await Exercise.autoLogToday(); } catch (_) { /* 失敗しても起動は続ける */ }
    showScreen('home');
  }

  // 端末にデータを残してもらう(ブラウザの自動削除を避ける)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((ok) => { if (!ok) navigator.storage.persist(); }).catch(() => {});
  }

  // サーバーに新しい版があればホームに通知
  fetchServerVersion().then((info) => {
    if (info.version !== APP_VERSION) {
      const b = document.getElementById('update-banner');
      document.getElementById('update-banner-text').textContent =
        `新しいバージョン v${info.version} があります`;
      b.classList.remove('hidden');
      document.getElementById('btn-banner-update').addEventListener('click', async () => {
        document.getElementById('update-banner-text').textContent = '更新中...';
        await purgeAll();
        setTimeout(hardReload, 400);
      });
    }
  }).catch(() => { /* オフラインなら何もしない */ });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skipWaiting');
      });
    });
    reg.update().catch(() => {});
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

boot();
