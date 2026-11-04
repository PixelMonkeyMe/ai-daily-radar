/* fav-core.js 纯逻辑单元测试（node --test，零依赖） */
const { test } = require("node:test");
const assert = require("node:assert");
const core = require("../../docs/fav-core.js");

test("rowToFav → favToRow 往返：收藏字段完整保留", () => {
  const fav = { u: "https://a.com/x", t: "标题", s: "来源", d: "2026-11-04",
                b: "简介", c: "模型/算法", m: "A",
                what: "是什么", industry_use: "行业用途", capability: "能力",
                assessment: "评估", risk: "风险", importance: 4,
                context_tags: "标签", context_note: "备注" };
  const row = core.favToRow(fav, "user-uuid");
  assert.strictEqual(row.user_id, "user-uuid");
  assert.strictEqual(row.url, fav.u);
  assert.strictEqual(row.context_note, "备注");
  const back = core.rowToFav(row);
  assert.strictEqual(back.u, fav.u);
  assert.strictEqual(back.context_tags, "标签");
  assert.strictEqual(back.importance, 4);
});

test("rowToFav 边界：空字段/缺字段不抛错", () => {
  const back = core.rowToFav({ url: "https://a.com", user_id: "u" });
  assert.strictEqual(back.u, "https://a.com");
  const empty = core.rowToFav({});
  assert.ok(typeof empty === "object");
});

test("autoCategorize：关键词命中分类", () => {
  assert.strictEqual(core.autoCategorize("HuggingFace", "BERT model release", ""), "模型/算法");
});

test("autoCategorize：无命中回退默认分类", () => {
  const c = core.autoCategorize("未知来源", "zzz 无关键词", "");
  assert.ok(typeof c === "string" && c.length > 0);
});

test("localLoad/localSave：localStorage 往返（mock）", () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const favs = [{ u: "https://a.com", t: "t1", s: "s", d: "2026-11-04", b: "b" }];
  core.localSave(favs);
  assert.deepStrictEqual(core.localLoad(), favs);
  delete global.localStorage;
});
