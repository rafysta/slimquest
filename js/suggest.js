/* SlimQuest - 献立の提案(手持ち食材が起点)
 *
 * 「何を作ろう」で止まるのが自炊が続かない一番の理由なので、
 * 手持ち食材リスト(js/pantry.js)をそのままAIに渡して料理候補を出させる。
 *
 * 表示で大事なのは材料の色分け。手持ちにあるものは緑、足りないものはグレーにして、
 * 「今すぐ作れるか / 何を買えばいいか」が一目で分かるようにしている。
 * 照合は Pantry.matches()(かな正規化+部分一致)なので、
 * AIが「豚肉」と書いても手持ちの「豚こま切れ肉」に当たる。
 *
 * 「これにする」を押すと、レシピとして menus に登録(1人分の値で記録される)し、
 * 足りない材料だけを買い物リストへ入れる。ここまでを1タップで終わらせる。
 */
'use strict';

const Suggest = {
  _dishes: [],
  _busy: false,

  /** 何人分作るか(レシピ登録と同じ既定値。2人分作って食べるのは1人分) */
  serves() {
    const el = document.getElementById('sg-serves');
    return Math.max(1, Math.round(Number(el && el.value) || 2));
  },

  /* ---------- 画面 ---------- */

  render() {
    this.renderPantry();
    if (!this._dishes.length) {
      document.getElementById('sg-result').innerHTML =
        '<p class="empty small">上のボタンを押すと、手持ちの食材から作れる料理を3〜5件出します。' +
        '材料のうち手持ちにあるものは緑、足りないものはグレーで表示されます。</p>';
    }
  },

  renderPantry() {
    const box = document.getElementById('sg-pantry');
    const names = Pantry.names();
    box.innerHTML = names.length
      ? `<p class="note">手持ちの食材 ${names.length}件</p>` +
        `<div class="chip-row">${names.map((n) =>
          `<span class="chip"><span class="chip-t">${escapeHtml(n)}</span></span>`).join('')}</div>`
      : '<p class="note">手持ち食材がまだ登録されていません。先に登録すると、' +
        'それを使い切る献立を出せます(空のままでも一般的な提案は出せます)。</p>';
  },

  /** 直近3日ぶんの食事名(同じものが続かないようにAIへ渡す) */
  async recentNames() {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const list = await Meals.byDate(Calc.addDays(Calc.today(), -i));
      list.forEach((m) => { if (m.name && out.indexOf(m.name) < 0) out.push(m.name); });
    }
    return out.slice(0, 20);
  },

  async run() {
    if (this._busy) return;
    if (!AI.hasKey()) {
      const ok = await appConfirm(
        '献立の提案を使うには Anthropic APIキーの設定が必要です。設定画面を開きますか?', '献立の提案');
      if (ok) showScreen('settings');
      return;
    }
    const box = document.getElementById('sg-result');
    this._busy = true;
    box.innerHTML = '<p class="ai-status">🍳 考えています...(十数秒かかります)</p>';
    try {
      const burned = await Exercise.burnedOn(Calc.today());
      const r = await AI.suggestDishes({
        pantry: Pantry.names(),
        recent: await this.recentNames(),
        serves: this.serves(),
        targetKcal: Math.round(Profile.targetIntake(burned) / 3)
      });
      this._dishes = r.dishes;
      this.renderResult();
    } catch (err) {
      box.innerHTML = `<p class="ai-status warn-text">⚠ ${escapeHtml(err.message)}</p>`;
    }
    this._busy = false;
  },

  renderResult() {
    const box = document.getElementById('sg-result');
    box.innerHTML = this._dishes.map((d, i) => {
      const ings = d.ingredients.map((x) => {
        const have = !!Pantry.matches(x.name);
        return `<span class="ing ${have ? 'have' : 'miss'}">${have ? '✓ ' : '＋ '}` +
          `${escapeHtml(x.name)}${x.amount ? `<small>${escapeHtml(x.amount)}</small>` : ''}</span>`;
      }).join('');
      const missing = d.ingredients.filter((x) => !Pantry.matches(x.name));
      return `
        <div class="card dish">
          <div class="dish-head">
            <h3>${escapeHtml(d.name)}</h3>
            <span class="food-kcal">${d.kcal}<small>kcal</small></span>
          </div>
          <p class="note">1人分 P ${d.p}g / F ${d.f}g / C ${d.c}g</p>
          ${d.reason ? `<p class="dish-reason">💡 ${escapeHtml(d.reason)}</p>` : ''}
          <div class="ing-row">${ings}</div>
          <p class="field-note">${missing.length
            ? `買い足し ${missing.length}件: ${escapeHtml(missing.map((x) => x.name).join('、'))}`
            : 'いまある材料だけで作れます'}</p>
          ${d.steps ? `<p class="dish-steps">${escapeHtml(d.steps)}</p>` : ''}
          <button class="btn primary" data-sg-adopt="${i}">これにする(レシピ登録＋買い物リスト)</button>
          <button class="btn ghost" data-sg-recipe="${i}">材料を選んで正確に登録する</button>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-sg-adopt]').forEach((b) =>
      b.addEventListener('click', () => this.adopt(Number(b.dataset.sgAdopt))));
    box.querySelectorAll('[data-sg-recipe]').forEach((b) =>
      b.addEventListener('click', () => this.toRecipe(Number(b.dataset.sgRecipe))));
  },

  /* ---------- 採用 ---------- */

  /**
   * レシピとして登録し、足りない材料を買い物リストへ入れる。
   * kcal/PFC はAIの概算をそのまま1人分として持つ(base は '1人分')。
   * 実際に作ったあとで正確にしたければ「材料を選んで登録」でレシピを作り直せる。
   */
  async adopt(i) {
    const d = this._dishes[i];
    if (!d) return;
    const serves = this.serves();
    const menu = await Menus.add({
      name: d.name,
      kana: d.name,
      base: '1人分',
      kcal: d.kcal,
      p: d.p,
      f: d.f,
      c: d.c,
      origin: 'suggest',
      serves,
      // 材料は「作った全体ぶん」。数値は持たない(合計はAIの1人分の値を使うため)
      ingredients: d.ingredients.map((x) => ({
        name: x.name, base: x.amount || '', factor: 1, kcal: 0, p: 0, f: 0, c: 0
      }))
    });

    const missing = d.ingredients.filter((x) => !Pantry.matches(x.name));
    for (const x of missing) await Shopping.add(x.name, x.amount, 'suggest');
    for (const x of d.ingredients) await IngWords.touch(x.name);

    Menus.touch(menu.id, Meals.slot);
    Streak.unlock('suggest');
    await appAlert(
      `「${menu.name}」をメニューに登録しました。食事を記録するときに1タップで選べます。\n\n` +
      (missing.length
        ? `買い物リストに追加: ${missing.map((x) => x.name).join('、')}`
        : '足りない材料はありません。'),
      'これにする');
  },

  /**
   * 材料をメニューDBの食品に当てはめてレシピ登録画面を開く。
   * カロリーをAIの概算ではなく食品データから積み上げたいときの経路。
   */
  toRecipe(i) {
    const d = this._dishes[i];
    if (!d) return;
    Recipes.openFresh();
    document.getElementById('rc-name').value = d.name;
    document.getElementById('rc-serves').value = String(this.serves());
    let hit = 0;
    d.ingredients.forEach((x) => {
      const m = Menus.search(x.name, 1)[0];
      if (m) { Recipes.addMenu(m); hit += 1; }
    });
    Recipes.render();
    showToast(hit
      ? `材料${hit}件を入れました。量を調整して登録してください`
      : '材料が見つかりませんでした。検索から追加してください');
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Suggest };
