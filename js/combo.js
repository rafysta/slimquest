/* SlimQuest - 組み合わせメニューの共通部品
 *
 * 「複数のメニューを選んで1つのメニューを作る」画面は2種類ある:
 *   セット   (js/meals.js の SetBuilder) … 合計をそのまま1回ぶんにする
 *   レシピ   (js/recipes.js の Recipes)  … 合計を人数で割って1人前にする
 * 部品の選択・量の増減・合計計算・保存はまったく同じなので、ここに1つだけ書き、
 * 画面ごとの違い(要素のID・保存時の origin・人数の有無)は cfg で渡す。
 *
 * cfg = {
 *   prefix        要素IDの接頭辞。'ms' なら #ms-name / #ms-items / #ms-search ...
 *   screen        showScreen() に渡す画面名
 *   origin        保存する menus レコードの origin ('set' / 'recipe')
 *   base          保存する基準量の表記 ('1セット' / '1人分')
 *   serves        true なら人数(#<prefix>-serves)で割る
 *   defaultServes 人数の既定値
 *   minItems      登録に必要な部品の数
 *   autoName      名前が空のときの自動命名 (items) => string
 * }
 */
'use strict';

function makeComboBuilder(cfg) {
  return {
    cfg,
    items: [],   // {menuId, name, base, factor, kcal, p, f, c}

    el(suffix) { return document.getElementById(`${cfg.prefix}-${suffix}`); },

    /** 入口のボタンから。作りかけは捨てて新規に始める */
    openFresh() {
      this.items = [];
      this.el('name').value = '';
      this.el('search').value = '';
      if (cfg.serves) this.el('serves').value = String(cfg.defaultServes);
      this.render();
      showScreen(cfg.screen);
    },

    render() {
      this.renderItems();
      this.renderResults();
    },

    /** 何人分作るか(レシピのみ。セットは常に1) */
    serves() {
      if (!cfg.serves) return 1;
      const el = this.el('serves');
      return Math.max(1, Math.round(Number(el && el.value) || cfg.defaultServes));
    },

    /** 部品の合計(作った全体ぶん) */
    totals() {
      return this.items.reduce((t, x) => ({
        kcal: t.kcal + x.kcal * x.factor,
        p: t.p + x.p * x.factor,
        f: t.f + x.f * x.factor,
        c: t.c + x.c * x.factor
      }), { kcal: 0, p: 0, f: 0, c: 0 });
    },

    /** 実際に記録される1回ぶん(レシピは合計÷人数) */
    perServing() {
      const t = this.totals();
      const n = this.serves();
      return { kcal: t.kcal / n, p: t.p / n, f: t.f / n, c: t.c / n };
    },

    renderItems() {
      const box = this.el('items');
      if (!this.items.length) {
        box.innerHTML = `<p class="empty small">${escapeHtml(cfg.emptyHint)}</p>`;
      } else {
        box.innerHTML = this.items.map((x, i) => `
          <div class="set-row">
            <span class="food-main">
              <span class="food-name">${escapeHtml(x.name)}</span>
              <span class="food-base">${escapeHtml(x.base)} × ${x.factor}</span>
            </span>
            <span class="food-kcal">${Math.round(x.kcal * x.factor)}<small>kcal</small></span>
            <span class="set-ctrls">
              <button data-cb-minus="${i}" aria-label="減らす">−</button>
              <button data-cb-plus="${i}" aria-label="増やす">＋</button>
              <button data-cb-del="${i}" class="set-del" aria-label="削除">×</button>
            </span>
          </div>`).join('');
        box.querySelectorAll('[data-cb-minus]').forEach((b) =>
          b.addEventListener('click', () => this.step(Number(b.dataset.cbMinus), -0.25)));
        box.querySelectorAll('[data-cb-plus]').forEach((b) =>
          b.addEventListener('click', () => this.step(Number(b.dataset.cbPlus), 0.25)));
        box.querySelectorAll('[data-cb-del]').forEach((b) =>
          b.addEventListener('click', () => {
            this.items.splice(Number(b.dataset.cbDel), 1);
            this.renderItems();
          }));
      }
      this.renderTotal();
    },

    renderTotal() {
      const box = this.el('total');
      if (!this.items.length) {
        box.innerHTML = '<span class="note">まだ何も入っていません</span>';
        return;
      }
      const t = this.totals();
      if (!cfg.serves) {
        box.innerHTML = `<b>合計 ${Math.round(t.kcal)} kcal</b>` +
          `<span class="note">P ${Calc.r1(t.p)}g / F ${Calc.r1(t.f)}g / C ${Calc.r1(t.c)}g</span>`;
        return;
      }
      const n = this.serves();
      const s = this.perServing();
      box.innerHTML =
        `<b>1人分 ${Math.round(s.kcal)} kcal</b>` +
        `<span class="note">P ${Calc.r1(s.p)}g / F ${Calc.r1(s.f)}g / C ${Calc.r1(s.c)}g</span>` +
        `<span class="note cb-whole">全体 ${Math.round(t.kcal)} kcal ÷ ${n}人分</span>`;
    },

    /** 部品の量を0.25刻みで増減する(牛乳150mlのような半端にも対応) */
    step(i, d) {
      const x = this.items[i];
      if (!x) return;
      x.factor = Math.max(0.25, Math.round((x.factor + d) * 100) / 100);
      this.renderItems();
    },

    /** 検索が空なら「よく食べるもの」を出す。セットの入れ子は不可 */
    renderResults() {
      const q = this.el('search').value.trim();
      const box = this.el('results');
      const list = (q ? Menus.search(q, 12) : Menus.frequent(Meals.slot, 8))
        .filter((m) => m.origin !== 'set');
      if (!list.length) {
        box.innerHTML = q
          ? '<p class="empty small">見つかりません。下の「新しく登録」から追加できます。</p>'
          : '';
        return;
      }
      box.innerHTML = list.map((m) => `
        <button class="food-row" data-cb-add="${m.id}">
          <span class="food-main">
            <span class="food-name">＋ ${escapeHtml(m.name)}</span>
            <span class="food-base">${escapeHtml(m.base)}</span>
          </span>
          <span class="food-kcal">${m.kcal}<small>kcal</small></span>
        </button>`).join('');
      box.querySelectorAll('[data-cb-add]').forEach((b) =>
        b.addEventListener('click', () => {
          const m = Menus.byId(b.dataset.cbAdd);
          if (m) this.addMenu(m);
          this.el('search').value = '';
          this.render();
        }));
    },

    addMenu(menu, factor) {
      this.items.push({
        menuId: menu.id, name: menu.name, base: menu.base,
        factor: factor || 1,
        kcal: menu.kcal, p: menu.p, f: menu.f, c: menu.c
      });
      this.renderItems();
    },

    async save(alsoRecord) {
      if (this.items.length < cfg.minItems) {
        appAlert(`${cfg.itemWord}を${cfg.minItems}つ以上追加してください`);
        return;
      }
      const s = this.perServing();
      const name = this.el('name').value.trim() || cfg.autoName(this.items);
      const rec = {
        name,
        kana: name,
        base: cfg.base,
        kcal: Math.round(s.kcal),
        p: Calc.r1(s.p),
        f: Calc.r1(s.f),
        c: Calc.r1(s.c),
        origin: cfg.origin,
        // 材料は「作った全体ぶん」を保存する。1人分の値は上の kcal/p/f/c 側に持つ。
        // こうしておくと Phase 3 の買い物リストがそのまま材料として使える。
        ingredients: this.items.map((x) => ({
          menuId: x.menuId, name: x.name, base: x.base, factor: x.factor,
          kcal: x.kcal, p: x.p, f: x.f, c: x.c
        }))
      };
      if (cfg.serves) rec.serves = this.serves();
      const menu = await Menus.add(rec);

      if (alsoRecord) {
        await Meals.add(Calc.today(), Meals.slot, menu, 1);
        Streak.recordToday();
        showToast(`${menu.name} を登録して${Meals.slotLabel(Meals.slot)}に記録しました`);
      } else {
        Menus.touch(menu.id, Meals.slot);
        showToast(`${menu.name} を登録しました`);
      }
      this.items = [];
      document.getElementById('meal-search').value = '';
      Meals.renderList();
      showScreen('meal-add');
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeComboBuilder };
