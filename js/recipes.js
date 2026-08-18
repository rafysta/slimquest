/* SlimQuest - レシピ登録(自炊した料理を材料から登録する)
 *
 * 2人分作って食べるのは1人分、という生活パターンが前提なので、
 * 何人分作るかの既定値は 2。材料の合計を人数で割った値が1回ぶんとして記録される。
 *
 * 保存されるのは普通の menus レコード(origin: 'recipe', base: '1人分', serves: 人数)。
 * ingredients には「作った全体ぶん」の材料を入れておく(Phase 3 の買い物リスト用)。
 * 中身の作りは js/combo.js の共通部品に任せている。
 */
'use strict';

const Recipes = makeComboBuilder({
  prefix: 'rc',
  screen: 'recipe-edit',
  origin: 'recipe',
  base: '1人分',
  serves: true,
  defaultServes: 2,
  minItems: 1,
  itemWord: '材料',
  emptyHint: '下の検索から材料(例: 豚こま切れ肉、じゃがいも、玉ねぎ)を追加してください。',
  autoName: (items) => items.slice(0, 3).map((x) => x.name).join('と') + 'の料理'
});

if (typeof module !== 'undefined' && module.exports) module.exports = { Recipes };
