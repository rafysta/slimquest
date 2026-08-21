/* SlimQuest - 体重の記録と推移グラフ
 *
 * グラフは外部ライブラリを使わず SVG を組み立てる。表示するもの:
 *   ・実測の折れ線と点
 *   ・7日移動平均(日々の水分変動に振り回されないため。実際はこの線を見る)
 *   ・目標線(目標体重)
 *   ・健康ペース帯(週0.5〜0.8kgで減った場合の範囲)
 */
'use strict';

const Weight = {
  _list: [],
  range: 'all',

  async load() {
    const all = await DB.getAll('weights');
    this._list = all.sort((a, b) => a.date.localeCompare(b.date));
    return this._list;
  },

  all() { return this._list; },

  latest() { return this._list.length ? this._list[this._list.length - 1] : null; },

  /** 記録がなければプロフィールの開始体重を使う */
  current() {
    const l = this.latest();
    if (l) return l.weight;
    const p = Profile.get();
    return p.startWeight || 70;
  },

  /**
   * その日の体重。過去の日の基礎代謝を計算するのに使う。
   * その日の記録がなければ「それ以前の直近の記録」、それも無ければ
   * 「その後の最初の記録」を使い、最後にプロフィールの開始体重へ落とす。
   * (毎日測るとは限らないので、空白の日は前後の実測で埋める)
   */
  onDate(ymd) {
    let before = null;
    for (const w of this._list) {
      if (w.date <= ymd) before = w; else break;
    }
    if (before) return before.weight;
    if (this._list.length) return this._list[0].weight;
    const p = Profile.get();
    return p.startWeight || 70;
  },

  async set(date, weight, bodyFat) {
    const rec = { date, weight: Calc.r1(weight) };
    if (bodyFat) rec.bodyFat = Calc.r1(bodyFat);
    await DB.put('weights', rec);
    const i = this._list.findIndex((w) => w.date === date);
    if (i >= 0) this._list[i] = rec; else this._list.push(rec);
    this._list.sort((a, b) => a.date.localeCompare(b.date));
    return rec;
  },

  async remove(date) {
    await DB.del('weights', date);
    this._list = this._list.filter((w) => w.date !== date);
  },

  /** 7日移動平均(その日を含む直近7日ぶんの実測の平均) */
  movingAvg() {
    return this._list.map((w, i) => {
      const from = Calc.addDays(w.date, -6);
      const win = this._list.filter((x, j) => j <= i && x.date >= from);
      const avg = win.reduce((s, x) => s + x.weight, 0) / win.length;
      return { date: w.date, weight: Math.round(avg * 100) / 100 };
    });
  },

  /* ---------- 画面 ---------- */

  async render() {
    await this.load();
    const p = Profile.get();
    const cur = this.current();
    const last = this.latest();

    document.getElementById('w-input').value = '';
    document.getElementById('w-bf').value = '';
    const todayRec = this._list.find((w) => w.date === Calc.today());
    document.getElementById('w-today-note').textContent = todayRec
      ? `今日は ${todayRec.weight}kg で記録済み(入力すると上書きします)`
      : '今日の体重はまだ記録していません';

    const diff = Calc.r1(cur - (p.startWeight || cur));
    const toGoal = Calc.r1(cur - (p.goalWeight || cur));
    document.getElementById('w-stats').innerHTML = `
      <div class="wstat"><span class="ws-label">現在</span><span class="ws-val">${cur}</span><small>kg</small></div>
      <div class="wstat"><span class="ws-label">開始から</span><span class="ws-val ${diff <= 0 ? 'good' : 'warn'}">${diff > 0 ? '+' : ''}${diff}</span><small>kg</small></div>
      <div class="wstat"><span class="ws-label">目標まで</span><span class="ws-val">${toGoal > 0 ? toGoal : 0}</span><small>kg</small></div>
      <div class="wstat"><span class="ws-label">BMI</span><span class="ws-val">${Calc.bmi(cur, p.height || 170)}</span><small></small></div>`;

    if (last) {
      const need = Calc.requiredPace(cur, p.goalWeight, Calc.today(), p.goalDate);
      document.getElementById('w-pace').textContent =
        `目標日まであと ${Math.max(0, Calc.diffDays(Calc.today(), p.goalDate))} 日 · ` +
        `いまの残りだと 週 ${Calc.r1(need)}kg のペースが必要です`;
    } else {
      document.getElementById('w-pace').textContent = '';
    }

    document.getElementById('w-graph').innerHTML = this.svg();
    document.querySelectorAll('#w-range [data-range]').forEach((b) => {
      b.classList.toggle('active', b.dataset.range === this.range);
    });
  },

  /** グラフのSVGを組み立てる */
  svg() {
    const p = Profile.get();
    const W = 320, H = 190, L = 34, R = 8, T = 10, B = 28;
    const today = Calc.today();

    let from, to;
    if (this.range === '1m') { from = Calc.addDays(today, -30); to = Calc.addDays(today, 7); }
    else if (this.range === '3m') { from = Calc.addDays(today, -90); to = Calc.addDays(today, 7); }
    else {
      // 全期間: 開始日と最初の記録の早い方から、目標日まで
      const first = this._list.length ? this._list[0].date : null;
      from = p.startDate || Calc.addDays(today, -7);
      if (first && first < from) from = first;
      to = p.goalDate || Calc.addDays(today, 30);
    }
    if (from >= to) to = Calc.addDays(from, 30);

    const pts = this._list.filter((w) => w.date >= from && w.date <= to);
    const avg = this.movingAvg().filter((w) => w.date >= from && w.date <= to);

    const weights = pts.map((w) => w.weight);
    const lo = Math.floor(Math.min(p.goalWeight || 60, ...(weights.length ? weights : [p.startWeight || 70])) - 1);
    const hi = Math.ceil(Math.max(p.startWeight || 70, ...(weights.length ? weights : [p.startWeight || 70])) + 1);
    const span = Math.max(1, hi - lo);
    const days = Math.max(1, Calc.diffDays(from, to));

    const x = (d) => L + (Calc.diffDays(from, d) / days) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / span) * (H - T - B);

    let s = `<svg viewBox="0 0 ${W} ${H}" class="wgraph" xmlns="http://www.w3.org/2000/svg">`;

    // 横罫線と目盛り
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = lo + (span / steps) * i;
      const yy = y(v);
      s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" class="wg-grid"/>`;
      s += `<text x="${L - 4}" y="${(yy + 3).toFixed(1)}" class="wg-axis" text-anchor="end">${Math.round(v)}</text>`;
    }

    // 健康ペース帯(週0.5〜0.8kg)
    if (p.startDate && p.startWeight) {
      const band = [];
      const bandBack = [];
      for (let i = 0; i <= days; i += Math.max(1, Math.round(days / 40))) {
        const d = Calc.addDays(from, i);
        if (d < p.startDate) continue;
        const b = Calc.paceBand(p.startWeight, p.startDate, d, p.goalWeight);
        band.push(`${x(d).toFixed(1)},${y(b.slow).toFixed(1)}`);
        bandBack.unshift(`${x(d).toFixed(1)},${y(b.fast).toFixed(1)}`);
      }
      if (band.length > 1) {
        s += `<polygon points="${band.concat(bandBack).join(' ')}" class="wg-band"/>`;
      }
    }

    // 目標線
    if (p.goalWeight) {
      const gy = y(p.goalWeight);
      if (gy > T && gy < H - B) {
        s += `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W - R}" y2="${gy.toFixed(1)}" class="wg-goal"/>`;
        s += `<text x="${W - R}" y="${(gy - 4).toFixed(1)}" class="wg-goal-t" text-anchor="end">目標 ${p.goalWeight}kg</text>`;
      }
    }

    // 今日の縦線
    if (today >= from && today <= to) {
      s += `<line x1="${x(today).toFixed(1)}" y1="${T}" x2="${x(today).toFixed(1)}" y2="${H - B}" class="wg-today"/>`;
    }

    // 実測
    if (pts.length > 1) {
      s += `<polyline points="${pts.map((w) => `${x(w.date).toFixed(1)},${y(w.weight).toFixed(1)}`).join(' ')}" class="wg-line"/>`;
    }
    // 7日移動平均
    if (avg.length > 2) {
      s += `<polyline points="${avg.map((w) => `${x(w.date).toFixed(1)},${y(w.weight).toFixed(1)}`).join(' ')}" class="wg-avg"/>`;
    }
    pts.forEach((w) => {
      s += `<circle cx="${x(w.date).toFixed(1)}" cy="${y(w.weight).toFixed(1)}" r="2.4" class="wg-dot"/>`;
    });

    // x軸ラベル(左端・今日・右端)
    const lbl = (d, anchor) =>
      `<text x="${x(d).toFixed(1)}" y="${H - 4}" class="wg-axis" text-anchor="${anchor}">${Calc.fmtShort(d).replace(/\(.\)/, '')}</text>`;
    s += lbl(from, 'start') + lbl(to, 'end');

    if (!pts.length) {
      s += `<text x="${W / 2}" y="${H / 2}" class="wg-empty" text-anchor="middle">体重を記録するとグラフが出ます</text>`;
    }
    s += '</svg>';
    return s;
  },

  async save() {
    const v = Number(document.getElementById('w-input').value);
    if (!v || v < 20 || v > 250) { appAlert('体重を正しく入力してください(20〜250kg)'); return; }
    const bf = Number(document.getElementById('w-bf').value) || 0;
    await this.set(Calc.today(), v, bf);
    Streak.recordToday();
    showToast(`${v}kg を記録しました`);
    await this.render();
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Weight };
