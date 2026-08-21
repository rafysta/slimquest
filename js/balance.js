/* SlimQuest - カロリー収支(摂取 − 消費)と週グラフ
 *
 *   収支 = 摂取 − (基礎消費 + 運動)
 *   マイナス = 消費のほうが多い = 減量できている日(緑・下向き)
 *   プラス   = 食べたぶんが上回った日(赤・上向き)
 *
 * 「目標摂取カロリー」を基準にするホーム画面のリングとは別物であることに注意。
 * ホームは「今日あと何kcal食べられるか」を見るもの(目標赤字を引いてある)、
 * ここは「実際に何kcalの過不足だったか」を見るもの(目標は関係しない)。
 * 同じ日でも数字が違うのは仕様。
 *
 * 基礎消費はその日の体重から計算する。過去にさかのぼるほど体重は違うので、
 * 常に今日の体重を使うと昔の日の収支がずれる(Profile.baseBurnOn → Weight.onDate)。
 *
 * 記録がない日は 0kcal 摂取ではなく「記録なし」として扱う。
 * そうしないと、入力し忘れた日が「−2400kcalの大成功」として並んでしまう。
 */
'use strict';

const Balance = {

  /* ---------- 計算 ---------- */

  /**
   * その日を含む週(月曜〜日曜)の7日ぶん。
   * 日ごとに問い合わせると14回のトランザクションになるので、
   * 週まるごと1回ずつ取ってから日付で振り分ける。
   */
  async week(anyDate) {
    const days = Calc.weekDays(anyDate);
    const [meals, exs] = await Promise.all([
      DB.byIndexRange('meals', 'date', days[0], days[6]),
      DB.byIndexRange('exercises', 'date', days[0], days[6])
    ]);
    const mBy = {}, eBy = {};
    meals.forEach((m) => { (mBy[m.date] = mBy[m.date] || []).push(m); });
    exs.forEach((e) => { eBy[e.date] = (eBy[e.date] || 0) + (e.kcal || 0); });

    return days.map((date) => {
      const list = mBy[date] || [];
      const intake = list.reduce((s, m) => s + (m.kcal || 0), 0);
      const exercise = eBy[date] || 0;
      const base = Profile.baseBurnOn(date);
      return {
        date,
        intake,
        base,
        exercise,
        burn: base + exercise,
        diff: intake - (base + exercise),
        hasData: list.length > 0
      };
    });
  },

  /** その日1日ぶん(日記のサマリーで使う) */
  ofDay(date, intake, exercise) {
    const base = Profile.baseBurnOn(date);
    return { base, burn: base + exercise, diff: intake - (base + exercise) };
  },

  /** 記録がある日だけの合計と平均 */
  summarize(days) {
    const rec = days.filter((d) => d.hasData);
    const total = rec.reduce((s, d) => s + d.diff, 0);
    return {
      days: rec.length,
      total,
      avg: rec.length ? Math.round(total / rec.length) : 0
    };
  },

  /* ---------- 週グラフ ---------- */

  /**
   * 0を中心に上下対称の棒グラフ。目盛りは 600kcal 以上で200刻みに切り上げるので、
   * 収支が小さい週に棒が大げさに見えることがない。
   */
  svg(days, selected) {
    const W = 320, H = 152, L = 36, R = 8, T = 12, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const mid = T + ph / 2;

    const maxAbs = Math.max(...days.filter((d) => d.hasData).map((d) => Math.abs(d.diff)), 0);
    const scale = Math.max(600, Math.ceil(maxAbs / 200) * 200);
    const y = (v) => mid - (Math.max(-scale, Math.min(scale, v)) / scale) * (ph / 2);

    const slot = pw / 7;
    const bw = Math.min(24, slot - 12);
    const today = Calc.today();

    let s = `<svg viewBox="0 0 ${W} ${H}" class="balgraph" xmlns="http://www.w3.org/2000/svg">`;

    // 目盛り(+scale / 0 / -scale)
    [scale, 0, -scale].forEach((v) => {
      const yy = y(v);
      s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" ` +
        `class="${v === 0 ? 'bal-zero' : 'bal-grid'}"/>`;
      s += `<text x="${L - 5}" y="${(yy + 3).toFixed(1)}" class="bal-axis" text-anchor="end">` +
        `${v > 0 ? '+' : ''}${v}</text>`;
    });

    days.forEach((d, i) => {
      const cx = L + slot * i + slot / 2;
      const dow = '日月火水木金土'[Calc.dow(d.date)];
      const isSel = d.date === selected;

      // タップ範囲を棒より広く取る(指で押しやすくするため)
      s += `<rect x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}" ` +
        `class="bal-hit${isSel ? ' sel' : ''}" data-bal-day="${d.date}"/>`;

      if (d.hasData) {
        const yy = y(d.diff);
        const top = Math.min(mid, yy);
        const h = Math.max(2, Math.abs(yy - mid));
        s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" ` +
          `width="${bw}" height="${h.toFixed(1)}" rx="3" ` +
          `class="bal-bar ${d.diff <= 0 ? 'good' : 'over'}"/>`;
        // 値は棒の外側(マイナスなら下、プラスなら上)に置く
        s += `<text x="${cx.toFixed(1)}" y="${(d.diff <= 0 ? yy + 10 : yy - 4).toFixed(1)}" ` +
          `class="bal-val" text-anchor="middle">${d.diff > 0 ? '+' : ''}${d.diff}</text>`;
      } else {
        s += `<line x1="${(cx - 5).toFixed(1)}" y1="${mid}" x2="${(cx + 5).toFixed(1)}" y2="${mid}" class="bal-none"/>`;
      }

      s += `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" ` +
        `class="bal-dow${isSel ? ' sel' : ''}${d.date === today ? ' today' : ''}">${dow}</text>`;
    });

    s += '</svg>';
    return s;
  },

  /** 食事日記の上部に描く。表示する週は日記で選んでいる日に追従する */
  async renderWeek(date) {
    const days = await this.week(date);
    const sum = this.summarize(days);

    document.getElementById('bal-week-label').textContent = Calc.fmtWeek(date);
    document.getElementById('bal-graph').innerHTML = this.svg(days, date);
    document.getElementById('btn-bal-next').disabled =
      Calc.weekStart(date) >= Calc.weekStart(Calc.today());

    // 脂肪換算(1kg ≒ 7200kcal)は 0.1kg 以上のときだけ添える。
    // 端数だと「約0kg」と出てしまい、かえって意味が伝わらないため
    const kg = Calc.r1(Math.abs(sum.total) / 7200);
    document.getElementById('bal-week-sum').innerHTML = sum.days
      ? `<span class="bal-sum-main ${sum.total <= 0 ? 'good' : 'over'}">` +
        `週合計 ${sum.total > 0 ? '+' : ''}${sum.total} kcal</span>` +
        `<span class="note">記録した${sum.days}日の平均 ${sum.avg > 0 ? '+' : ''}${sum.avg} kcal/日` +
        `${kg >= 0.1 ? ` · 脂肪 約${kg}kg ${sum.total < 0 ? '減' : '増'}のペース` : ''}</span>`
      : '<span class="note">この週はまだ記録がありません</span>';

    // 棒をタップしたらその日の日記へ
    document.querySelectorAll('#bal-graph [data-bal-day]').forEach((el) => {
      el.addEventListener('click', () => Meals.renderDiary(el.dataset.balDay));
    });
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Balance };
