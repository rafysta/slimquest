/* SlimQuest - 食事の記録(入力画面・新規メニュー登録・食事日記)
 *
 * 入力の速さを最優先にしている:
 *   画面を開く → 時間帯から食事区分を自動選択 → よく食べるものをタップ → 倍率を選んで登録
 * この2〜3タップで終わることが、記録を続けられるかどうかを決める。
 */
'use strict';

const SLOTS = [
  { key: 'b', label: '朝食', icon: '🌅' },
  { key: 'l', label: '昼食', icon: '☀️' },
  { key: 'd', label: '夕食', icon: '🌙' },
  { key: 's', label: '間食', icon: '🍪' }
];

const Meals = {
  slot: 'l',
  diaryDate: '',

  /** これから記録する日。日記から入ったときだけ今日以外になる */
  targetDate: '',
  /** 食事入力画面の戻り先('home' / 'diary') */
  backTo: 'home',

  date() { return this.targetDate || Calc.today(); },
  isToday() { return this.date() === Calc.today(); },

  /* ---------- データ ---------- */

  /** 時間帯から食事区分を推測 */
  slotByHour(h) {
    const hour = h === undefined ? new Date().getHours() : h;
    if (hour < 10) return 'b';
    if (hour < 15) return 'l';
    if (hour < 22) return 'd';
    return 's';
  },

  slotLabel(key) {
    const s = SLOTS.find((x) => x.key === key);
    return s ? s.label : '食事';
  },

  async byDate(date) {
    const list = await DB.byIndex('meals', 'date', date);
    return list.sort((a, b) => (a.id || 0) - (b.id || 0));
  },

  /** メニューと倍率から1件記録する。数値はスナップショットで持つ */
  async add(date, slot, menu, factor) {
    const f = Number(factor) || 1;
    const rec = {
      date,
      slot,
      menuId: menu.id,
      name: menu.name,
      base: menu.base,
      factor: Math.round(f * 100) / 100,
      kcal: Math.round(menu.kcal * f),
      p: Calc.r1(menu.p * f),
      f2: Calc.r1(menu.f * f),
      c: Calc.r1(menu.c * f)
    };
    rec.id = await DB.add('meals', rec);
    Menus.touch(menu.id, slot);
    return rec;
  },

  remove(id) { return DB.del('meals', Number(id)); },

  totals(list) {
    return list.reduce((t, m) => ({
      kcal: t.kcal + (m.kcal || 0),
      p: Calc.r1(t.p + (m.p || 0)),
      f: Calc.r1(t.f + (m.f2 || 0)),
      c: Calc.r1(t.c + (m.c || 0))
    }), { kcal: 0, p: 0, f: 0, c: 0 });
  },

  /* ---------- 食事入力画面 ---------- */

  /**
   * 食事入力画面を開く。
   * from に 'diary' を渡すと日記で開いている日に記録し、戻るボタンも日記に返る。
   * (過去の食べ忘れをあとから足せるようにするため)
   */
  openAdd(slot, from) {
    this.slot = slot || this.slotByHour();
    this.backTo = from === 'diary' ? 'diary' : 'home';
    this.targetDate = from === 'diary' ? (this.diaryDate || Calc.today()) : Calc.today();
    const input = document.getElementById('meal-search');
    input.value = '';
    this.renderDateNote();
    this.renderSlotTabs();
    this.renderList();
    showScreen('meal-add');
  },

  /** 今日以外に記録するときだけ、どの日に入るかを目立たせる */
  renderDateNote() {
    const el = document.getElementById('ma-date-note');
    if (!el) return;
    if (this.isToday()) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = `📅 ${Calc.fmtShort(this.date())} の記録として追加します`;
      el.classList.remove('hidden');
    }
  },

  renderSlotTabs() {
    const el = document.getElementById('slot-tabs');
    el.innerHTML = SLOTS.map((s) =>
      `<button class="slot-tab${s.key === this.slot ? ' active' : ''}" data-slot="${s.key}">` +
      `${s.icon} ${s.label}</button>`).join('');
    el.querySelectorAll('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        this.slot = b.dataset.slot;
        this.renderSlotTabs();
        this.renderList();
      });
    });
  },

  /** 検索が空なら「よく食べるもの」、入力があれば検索結果を出す */
  renderList() {
    const q = document.getElementById('meal-search').value.trim();
    const box = document.getElementById('meal-results');
    const title = document.getElementById('meal-list-title');
    let list;
    if (q) {
      list = Menus.search(q, 40);
      title.textContent = `「${q}」の候補 ${list.length}件`;
    } else {
      list = Menus.frequent(this.slot, 14);
      title.textContent = list.length
        ? `よく食べるもの(${this.slotLabel(this.slot)})`
        : 'まずは検索して選んでください';
    }

    if (!list.length) {
      box.innerHTML = q
        ? '<p class="empty">見つかりませんでした。下の「新しく登録」から追加できます。</p>'
        : '<p class="empty">記録するとここによく食べるものが並びます。<br>上の検索から食べたものを探してください。</p>';
      return;
    }

    box.innerHTML = list.map((m) => `
      <button class="food-row" data-menu="${m.id}">
        <span class="food-main">
          <span class="food-name">${escapeHtml(m.name)}</span>
          <span class="food-base">${escapeHtml(m.base)}</span>
        </span>
        <span class="food-kcal">${m.kcal}<small>kcal</small></span>
      </button>`).join('');

    box.querySelectorAll('[data-menu]').forEach((b) => {
      b.addEventListener('click', () => this.openAmount(Number(b.dataset.menu)));
    });
  },

  /* ---------- 量の指定シート ---------- */

  _pending: null,

  openAmount(menuId) {
    const m = Menus.byId(menuId);
    if (!m) return;
    this._pending = m;
    document.getElementById('as-name').textContent = m.name;
    document.getElementById('as-base').textContent = `基準: ${m.base}`;
    const slider = document.getElementById('as-slider');
    slider.value = '1';
    this.setFactor(1);
    const ing = document.getElementById('as-ing');
    if (m.ingredients && m.ingredients.length) {
      const label = m.serves > 1 ? `材料(${m.serves}人分)` : '内訳';
      ing.innerHTML = `${label}: ` + m.ingredients.map((x) =>
        `${escapeHtml(x.name)}${x.factor !== 1 ? `×${x.factor}` : ''}`).join(' + ');
      ing.classList.remove('hidden');
    } else {
      ing.classList.add('hidden');
    }
    document.getElementById('amount-sheet').classList.remove('hidden');
  },

  closeAmount() {
    document.getElementById('amount-sheet').classList.add('hidden');
    this._pending = null;
  },

  setFactor(f) {
    const m = this._pending;
    if (!m) return;
    const v = Math.round(Number(f) * 100) / 100;
    document.getElementById('as-slider').value = String(v);
    document.getElementById('as-factor').textContent = `× ${v}`;
    document.getElementById('as-kcal').textContent = `${Math.round(m.kcal * v)} kcal`;
    document.getElementById('as-pfc').textContent =
      `P ${Calc.r1(m.p * v)}g / F ${Calc.r1(m.f * v)}g / C ${Calc.r1(m.c * v)}g`;
    document.querySelectorAll('#as-quick [data-f]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.f) === v);
    });
  },

  async commitAmount() {
    const m = this._pending;
    if (!m) return;
    const f = Number(document.getElementById('as-slider').value) || 1;
    const d = this.date();
    await this.add(d, this.slot, m, f);
    this.closeAmount();
    showToast(this.isToday()
      ? `${m.name} を${this.slotLabel(this.slot)}に記録しました`
      : `${Calc.fmtShort(d)} の${this.slotLabel(this.slot)}に記録しました`);
    // 連続記録は「今日記録したか」なので、過去日を埋めたときは数えない
    if (this.isToday()) Streak.recordToday();
    document.getElementById('meal-search').value = '';
    this.renderList();
  },

  /* ---------- 新規メニューの手動登録 ---------- */

  /** セット/レシピ画面から呼ばれたときは、その builder を入れておく
   *  (保存後にそこへ材料として追加して画面を戻す) */
  newCombo: null,
  /** バーコードから来たときの JAN(保存時にメニューへ付ける) */
  pendingJan: '',

  /**
   * prefill は文字列(名前だけ)でも、
   * {name, base, kcal, p, f, c, jan, origin} のオブジェクトでもよい。
   * combo にセット/レシピの builder を渡すと「登録して追加」モードになる。
   */
  openNew(prefill, combo) {
    this.newCombo = combo || null;
    this.editing = null;
    const pre = typeof prefill === 'string' ? { name: prefill } : (prefill || {});
    this.pendingJan = pre.jan || '';
    const nameEl = document.getElementById('mn-name');
    nameEl.value = pre.name || '';
    if (pre.origin) nameEl.dataset.origin = pre.origin;
    else delete nameEl.dataset.origin;
    document.getElementById('mn-base').value = pre.base || '1人前';
    const set = (id, v) => {
      document.getElementById(id).value = (v === undefined || v === null || v === '') ? '' : String(v);
    };
    set('mn-kcal', pre.kcal);
    set('mn-p', pre.p);
    set('mn-f', pre.f);
    set('mn-c', pre.c);
    AiUI.reset();
    document.getElementById('btn-mn-save-record').classList.toggle('hidden', !!this.newCombo);
    document.getElementById('btn-mn-save').textContent =
      this.newCombo ? `登録して${this.newCombo.cfg.itemWord}に追加` : '登録だけする';
    document.getElementById('btn-mn-delete').classList.add('hidden');
    document.getElementById('mn-ing').classList.add('hidden');
    document.getElementById('mn-title').textContent = '新しいメニュー';
    document.getElementById('mn-jan').textContent =
      this.pendingJan ? `バーコード: ${this.pendingJan}` : '';
    showScreen('meal-new');
  },

  /* ---------- 登録済みメニューの編集 ---------- */

  /** 編集中のメニュー(null なら新規登録モード) */
  editing: null,

  /**
   * 同じフォームを使い回して編集する。セット/レシピの材料そのものは直せないが、
   * 名前とカロリーは直せるので、間違えて登録したものを片付けるには十分。
   * 材料は保持したまま保存する(記録済みの食事には影響しない)。
   */
  openEdit(menuId) {
    const m = Menus.byId(menuId);
    if (!m) return;
    if (m.id < 0) { appAlert('同梱の食品データは変更できません。似たものを新しく登録してください。'); return; }
    this.newCombo = null;
    this.editing = m;
    this.pendingJan = m.jan || '';
    const nameEl = document.getElementById('mn-name');
    nameEl.value = m.name;
    delete nameEl.dataset.origin;
    document.getElementById('mn-base').value = m.base || '1人前';
    const set = (id, v) => { document.getElementById(id).value = String(v === undefined ? '' : v); };
    set('mn-kcal', m.kcal);
    set('mn-p', m.p);
    set('mn-f', m.f);
    set('mn-c', m.c);
    AiUI.reset();
    document.getElementById('btn-mn-save-record').classList.add('hidden');
    document.getElementById('btn-mn-save').textContent = '変更を保存する';
    document.getElementById('btn-mn-delete').classList.remove('hidden');
    document.getElementById('mn-title').textContent = 'メニューを直す';
    document.getElementById('mn-jan').textContent = m.jan ? `バーコード: ${m.jan}` : '';
    const ing = document.getElementById('mn-ing');
    if (m.ingredients && m.ingredients.length) {
      ing.textContent = `材料・内訳: ${m.ingredients.map((x) => x.name).join(' + ')}` +
        '(材料の組み合わせ自体は変えられません。作り直したいときは新しく登録してください)';
      ing.classList.remove('hidden');
    } else {
      ing.classList.add('hidden');
    }
    showScreen('meal-new');
  },

  async saveEdit() {
    const m = this.editing;
    if (!m) return;
    const name = document.getElementById('mn-name').value.trim();
    if (!name) { appAlert('メニュー名を入力してください'); return; }
    const kcal = Number(document.getElementById('mn-kcal').value);
    if (!kcal || kcal <= 0) { appAlert('カロリーを入力してください'); return; }
    const rec = Object.assign({}, m, {
      name,
      kana: Calc.norm(name),
      base: document.getElementById('mn-base').value.trim() || '1人前',
      kcal: Math.round(kcal),
      p: Calc.r1(document.getElementById('mn-p').value),
      f: Calc.r1(document.getElementById('mn-f').value),
      c: Calc.r1(document.getElementById('mn-c').value)
    });
    await Menus.update(rec);
    this.editing = null;
    showToast(`${rec.name} を保存しました`);
    MenuList.render();
    showScreen('menu-list');
  },

  async deleteEditing() {
    const m = this.editing;
    if (!m) return;
    const ok = await appConfirm(
      `「${m.name}」をメニューから消します。\n\n` +
      '食事日記に残っている過去の記録はそのままです(記録には登録時の数値が入っているため)。',
      'メニューの削除');
    if (!ok) return;
    await Menus.remove(m.id);
    this.editing = null;
    showToast(`${m.name} を削除しました`);
    MenuList.render();
    showScreen('menu-list');
  },

  async saveNew(alsoRecord) {
    if (this.editing) { await this.saveEdit(); return; }
    const nameEl = document.getElementById('mn-name');
    const name = nameEl.value.trim();
    if (!name) { appAlert('メニュー名を入力してください'); return; }
    const kcal = Number(document.getElementById('mn-kcal').value);
    if (!kcal || kcal <= 0) { appAlert('カロリーを入力してください'); return; }
    const rec = {
      name,
      kana: name,
      base: document.getElementById('mn-base').value.trim() || '1人前',
      kcal,
      p: Number(document.getElementById('mn-p').value) || 0,
      f: Number(document.getElementById('mn-f').value) || 0,
      c: Number(document.getElementById('mn-c').value) || 0,
      origin: nameEl.dataset.origin || 'manual'
    };
    if (this.pendingJan) rec.jan = this.pendingJan;
    const menu = await Menus.add(rec);
    if (rec.jan) Streak.unlock('barcode');
    delete nameEl.dataset.origin;
    this.pendingJan = '';
    if (this.newCombo) {
      const cb = this.newCombo;
      this.newCombo = null;
      cb.addMenu(menu);
      showToast(`${menu.name} を登録して追加しました`);
      showScreen(cb.cfg.screen);
      return;
    }
    if (alsoRecord) {
      await this.add(this.date(), this.slot, menu, 1);
      if (this.isToday()) Streak.recordToday();
      showToast(`${menu.name} を登録して記録しました`);
    } else {
      Menus.touch(menu.id, this.slot);
      showToast(`${menu.name} を登録しました`);
    }
    document.getElementById('meal-search').value = '';
    this.renderList();
    showScreen('meal-add');
  },

  /* ---------- 日記のカレンダー ---------- */

  /* 日送りだけだと「先週の月曜」に行くのに何度もタップすることになるので、
   * 月のカレンダーから直接飛べるようにする。記録がある日は摂取カロリーを出し、
   * どこに穴が空いているかも一目で分かるようにした。 */

  calYm: '',

  calEl() { return document.getElementById('diary-cal'); },

  async toggleCal() {
    const el = this.calEl();
    if (el.classList.contains('hidden')) {
      await this.renderCal((this.diaryDate || Calc.today()).slice(0, 7));
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },

  /** ym は 'YYYY-MM'。n ヶ月ずらす */
  shiftMonth(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

  async renderCal(ym) {
    this.calYm = ym;
    const [y, m] = ym.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const p2 = (n) => String(n).padStart(2, '0');
    const first = `${ym}-01`;
    const last = `${ym}-${p2(days)}`;
    const today = Calc.today();

    // その月ぶんの食事を1回のトランザクションで取り、日ごとに合計する
    const meals = await DB.byIndexRange('meals', 'date', first, last);
    const sum = {};
    meals.forEach((x) => { sum[x.date] = (sum[x.date] || 0) + (x.kcal || 0); });

    document.getElementById('cal-title').textContent = `${y}年 ${m}月`;
    document.getElementById('btn-cal-next').disabled = (ym >= today.slice(0, 7));

    let html = '';
    const lead = new Date(y, m - 1, 1).getDay();
    for (let i = 0; i < lead; i++) html += '<span class="cal-pad"></span>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${ym}-${p2(d)}`;
      const cls = ['cal-d'];
      if (ymd === today) cls.push('today');
      if (ymd === this.diaryDate) cls.push('sel');
      if (sum[ymd]) cls.push('has');
      html += `<button class="${cls.join(' ')}" data-cal="${ymd}"${ymd > today ? ' disabled' : ''}>` +
        `<span class="cal-n">${d}</span>` +
        `<small>${sum[ymd] ? sum[ymd] : ''}</small></button>`;
    }
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = html;
    grid.querySelectorAll('[data-cal]').forEach((b) => {
      b.addEventListener('click', () => {
        this.calEl().classList.add('hidden');
        this.renderDiary(b.dataset.cal);
      });
    });
  },

  /* ---------- 食事日記 ---------- */

  async renderDiary(date) {
    if (date) this.diaryDate = date;
    if (!this.diaryDate) this.diaryDate = Calc.today();
    const d = this.diaryDate;
    document.getElementById('diary-date').textContent = Calc.fmtShort(d);
    document.getElementById('btn-diary-next').disabled = (d >= Calc.today());
    // カレンダーを開いたまま日を移ったときは選択位置を追従させる
    if (!this.calEl().classList.contains('hidden')) await this.renderCal(d.slice(0, 7));

    const [meals, exs] = await Promise.all([this.byDate(d), Exercise.byDate(d)]);
    const t = this.totals(meals);
    const burned = exs.reduce((s, e) => s + (e.kcal || 0), 0);

    let html = `<div class="diary-summary card">
      <div><span class="ds-label">摂取</span><span class="ds-val">${t.kcal}</span><small>kcal</small></div>
      <div><span class="ds-label">運動</span><span class="ds-val">-${burned}</span><small>kcal</small></div>
      <div class="ds-pfc">P ${t.p}g / F ${t.f}g / C ${t.c}g</div>
    </div>`;

    SLOTS.forEach((s) => {
      const items = meals.filter((m) => m.slot === s.key);
      const sub = items.reduce((n, m) => n + m.kcal, 0);
      html += `<h3 class="diary-h">${s.icon} ${s.label}<span>${sub} kcal</span></h3>`;
      html += items.length
        ? '<ul class="diary-list">' + items.map((m) => `
            <li>
              <span class="dl-name">${escapeHtml(m.name)}${m.factor !== 1 ? ` <small>×${m.factor}</small>` : ''}</span>
              <span class="dl-kcal">${m.kcal}</span>
              <button class="dl-del" data-del-meal="${m.id}">×</button>
            </li>`).join('') + '</ul>'
        : '<p class="empty small">記録なし</p>';
    });

    html += `<h3 class="diary-h">🏃 運動<span>${burned} kcal</span></h3>`;
    html += exs.length
      ? '<ul class="diary-list">' + exs.map((e) => `
          <li>
            <span class="dl-name">${escapeHtml(e.type)} <small>${e.minutes}分${e.auto ? ' · 自動' : ''}</small></span>
            <span class="dl-kcal">${e.kcal}</span>
            <button class="dl-del" data-del-ex="${e.id}">×</button>
          </li>`).join('') + '</ul>'
      : '<p class="empty small">記録なし</p>';

    const body = document.getElementById('diary-body');
    body.innerHTML = html;
    body.querySelectorAll('[data-del-meal]').forEach((b) => {
      b.addEventListener('click', async () => {
        await this.remove(b.dataset.delMeal);
        this.renderDiary();
      });
    });
    body.querySelectorAll('[data-del-ex]').forEach((b) => {
      b.addEventListener('click', async () => {
        await Exercise.remove(b.dataset.delEx);
        this.renderDiary();
      });
    });
  }
};

/* ---------- セット(組み合わせ)メニューの作成 ----------
 *
 * 「シリアル+プロテイン+牛乳」のようにいつも一緒に食べる組み合わせを、
 * 1つのメニューとして登録する。合計カロリー・PFCは構成要素から自動計算。
 * 構成要素は普通のメニューのままなので、単品でも記録できる
 * (シリアル+牛乳+果物のような別の組み合わせの日にも対応できる)。
 * 記録は1行(1セット)で入り、内訳は量の指定シートに表示される。
 *
 * 中身の作りはレシピ登録と共通(js/combo.js)。違いは人数で割らないことだけ。
 */

/* ---------- 登録済みメニューの一覧(整理用)----------
 *
 * 間違えて登録したメニューが「よく食べるもの」に残り続けるのが地味に困るので、
 * 一覧から直接 編集/削除 できるようにした。編集画面は meal-new を使い回す。
 * 同梱食品(id が負)はアプリ更新のたびに作り直されるため、ここには出さない。
 */

const ORIGIN_LABEL = {
  manual: '手入力', ai: 'AI検索', barcode: 'バーコード', off: 'バーコード',
  set: 'セット', recipe: 'レシピ', suggest: '献立提案'
};

const MenuList = {
  render() {
    const q = document.getElementById('ml-search').value.trim();
    const box = document.getElementById('ml-list');
    const all = Menus._custom.slice().sort((a, b) => (b.id || 0) - (a.id || 0));
    const list = q
      ? Menus.search(q, 100).filter((m) => m.id > 0)
      : all;

    document.getElementById('ml-count').textContent = q
      ? `「${q}」の候補 ${list.length}件`
      : `登録したメニュー(${all.length})`;

    if (!list.length) {
      box.innerHTML = q
        ? '<p class="empty small">見つかりませんでした。</p>'
        : '<p class="empty small">まだ自分で登録したメニューがありません。' +
          '食事入力の「＋ 新しく登録する」やレシピ登録で作ったものがここに並びます。</p>';
      return;
    }

    box.innerHTML = list.map((m) => {
      const u = Menus.useOf(m.id);
      return `
      <button class="food-row" data-ml="${m.id}">
        <span class="food-main">
          <span class="food-name">${escapeHtml(m.name)}</span>
          <span class="food-base">${escapeHtml(m.base)} · ${escapeHtml(ORIGIN_LABEL[m.origin] || m.origin || '手入力')}` +
        `${u.n ? ` · ${u.n}回` : ' · 未使用'}</span>
        </span>
        <span class="food-kcal">${m.kcal}<small>kcal</small></span>
      </button>`;
    }).join('');

    box.querySelectorAll('[data-ml]').forEach((b) => {
      b.addEventListener('click', () => Meals.openEdit(Number(b.dataset.ml)));
    });
  }
};

const SetBuilder = makeComboBuilder({
  prefix: 'ms',
  screen: 'meal-set',
  origin: 'set',
  base: '1セット',
  serves: false,
  defaultServes: 1,
  minItems: 2,
  itemWord: '構成要素',
  emptyHint: '下の検索から構成要素(例: シリアル、プロテイン、牛乳)を追加してください。',
  autoName: (items) => items.map((x) => x.name).join('+')
});

if (typeof module !== 'undefined' && module.exports) module.exports = { Meals, SLOTS, SetBuilder, MenuList };
