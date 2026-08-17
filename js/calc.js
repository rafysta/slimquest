/* SlimQuest - 計算まわりの純粋関数
 * 日付・かな正規化・基礎代謝・運動カロリー・目標ペースなど。
 * 副作用を持たせないこと(テストしやすさのため)。
 */
'use strict';

const Calc = {
  /* ---------- 日付 ---------- */

  /** Dateを 'YYYY-MM-DD' に(ローカル時刻基準) */
  ymd(d) {
    const dt = d ? new Date(d) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  },

  today() { return this.ymd(new Date()); },

  /** 'YYYY-MM-DD' に日数を足す */
  addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return this.ymd(dt);
  },

  /** a から b までの日数(b - a) */
  diffDays(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
  },

  /** 表示用 '8/17(月)' */
  fmtShort(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${m}/${d}(${'日月火水木金土'[dt.getDay()]})`;
  },

  /** 平日かどうか(自転車通勤の自動計上に使う) */
  isWeekday(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const w = new Date(y, m - 1, d).getDay();
    return w >= 1 && w <= 5;
  },

  /* ---------- かな正規化(検索用) ---------- */

  /**
   * 検索キーを揃える。カタカナ→ひらがな、全角英数→半角、大文字→小文字、
   * 空白と記号を除去。「唐揚げ」「からあげ」「カラアゲ」を同じ土俵に乗せるため、
   * データ側に読み(kana)を持たせて両方を対象に照合する。
   */
  norm(s) {
    if (!s) return '';
    return String(s)
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[ー－\-\s　,、.。()（）]/g, '')
      .toLowerCase();
  },

  /** 検索一致の強さ: 2=前方一致 / 1=部分一致 / 0=不一致 */
  matchScore(hay, needle) {
    if (!needle) return 0;
    const i = hay.indexOf(needle);
    if (i === 0) return 2;
    if (i > 0) return 1;
    return 0;
  },

  /* ---------- 体・カロリー ---------- */

  /** 満年齢 */
  age(birthYear, birthMonth, today) {
    const t = today || this.today();
    const [y, m] = t.split('-').map(Number);
    let a = y - Number(birthYear);
    if (m < Number(birthMonth || 1)) a -= 1;
    return Math.max(0, a);
  },

  /**
   * 基礎代謝 (Mifflin-St Jeor)
   * 男性: 10W + 6.25H - 5A + 5 / 女性: 同 -161
   */
  bmr(weightKg, heightCm, age, sex) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return Math.round(base + (sex === 'female' ? -161 : 5));
  },

  /**
   * 1日の基礎的な消費(運動を除く)。
   * 活動係数は低め(1.2)に固定し、運動は個別に加算する。
   * こうしないと「活動的」係数と運動記録で二重に計上してしまう。
   */
  baseBurn(bmrValue) { return Math.round(bmrValue * 1.2); },

  /** 運動の消費カロリー: METs × 体重 × 時間 × 1.05 */
  exerciseKcal(mets, weightKg, minutes) {
    return Math.round(mets * weightKg * (minutes / 60) * 1.05);
  },

  /* ---------- 目標とペース ---------- */

  /**
   * 1日の目標赤字。目標体重・目標日から必要ペースを出すが、
   * 無理をさせないため 600kcal/日 を上限にする(体重1kg ≒ 7200kcal)。
   */
  targetDeficit(currentWeight, goalWeight, today, goalDate) {
    const days = Math.max(1, this.diffDays(today, goalDate));
    const need = (currentWeight - goalWeight) * 7200 / days;
    return Math.max(0, Math.min(600, Math.round(need)));
  },

  /** 週あたりの必要減量ペース(kg/週) */
  requiredPace(currentWeight, goalWeight, today, goalDate) {
    const days = Math.max(1, this.diffDays(today, goalDate));
    return (currentWeight - goalWeight) / (days / 7);
  },

  /**
   * 健康的なペース帯(週0.5〜0.8kg)で減った場合の、ある日の体重範囲。
   * グラフに薄い帯として描き、目標線と見比べられるようにする。
   */
  paceBand(startWeight, startDate, ymd, goalWeight) {
    const weeks = this.diffDays(startDate, ymd) / 7;
    const slow = Math.max(goalWeight, startWeight - 0.5 * weeks);
    const fast = Math.max(goalWeight, startWeight - 0.8 * weeks);
    return { slow, fast };
  },

  /** BMI */
  bmi(weightKg, heightCm) {
    const h = heightCm / 100;
    return Math.round((weightKg / (h * h)) * 10) / 10;
  },

  /** 数値を安全に丸める(NaN対策) */
  r1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Calc };
