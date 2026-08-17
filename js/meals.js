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

  openAdd(slot) {
    this.slot = slot || this.slotByHour();
    const input = document.getElementById('meal-search');
    input.value = '';
    this.renderSlotTabs();
    this.renderList();
    showScreen('meal-add');
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
    await this.add(Calc.today(), this.slot, m, f);
    this.closeAmount();
    showToast(`${m.name} を${this.slotLabel(this.slot)}に記録しました`);
    Streak.recordToday();
    document.getElementById('meal-search').value = '';
    this.renderList();
  },

  /* ---------- 新規メニューの手動登録 ---------- */

  openNew(prefill) {
    document.getElementById('mn-name').value = prefill || '';
    document.getElementById('mn-base').value = '1人前';
    ['mn-kcal', 'mn-p', 'mn-f', 'mn-c'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    showScreen('meal-new');
  },

  async saveNew(alsoRecord) {
    const name = document.getElementById('mn-name').value.trim();
    if (!name) { appAlert('メニュー名を入力してください'); return; }
    const kcal = Number(document.getElementById('mn-kcal').value);
    if (!kcal || kcal <= 0) { appAlert('カロリーを入力してください'); return; }
    const menu = await Menus.add({
      name,
      kana: name,
      base: document.getElementById('mn-base').value.trim() || '1人前',
      kcal,
      p: Number(document.getElementById('mn-p').value) || 0,
      f: Number(document.getElementById('mn-f').value) || 0,
      c: Number(document.getElementById('mn-c').value) || 0,
      origin: 'manual'
    });
    if (alsoRecord) {
      await this.add(Calc.today(), this.slot, menu, 1);
      Streak.recordToday();
      showToast(`${menu.name} を登録して記録しました`);
    } else {
      Menus.touch(menu.id, this.slot);
      showToast(`${menu.name} を登録しました`);
    }
    document.getElementById('meal-search').value = '';
    this.renderList();
    showScreen('meal-add');
  },

  /* ---------- 食事日記 ---------- */

  async renderDiary(date) {
    if (date) this.diaryDate = date;
    if (!this.diaryDate) this.diaryDate = Calc.today();
    const d = this.diaryDate;
    document.getElementById('diary-date').textContent = Calc.fmtShort(d);
    document.getElementById('btn-diary-next').disabled = (d >= Calc.today());

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

if (typeof module !== 'undefined' && module.exports) module.exports = { Meals, SLOTS };
