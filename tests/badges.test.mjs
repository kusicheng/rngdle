import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateBadges, matchBadge, scorePercentile, summarizeRoll, rollTier } from '../public/js/badges.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/badges.json'), 'utf8'));
const distribution = JSON.parse(fs.readFileSync(path.join(root, 'data/score-distribution.json'), 'utf8'));
const missing = JSON.parse(fs.readFileSync(path.join(root, 'data/missing-badges.json'), 'utf8'));
const byId = new Map(catalog.map(badge => [badge.id, badge]));

assert.equal(catalog.length, 233);
assert.equal(byId.size, catalog.length);
assert.equal(missing.missing.length, 0);
for (const badge of catalog) {
  assert.ok(badge.name && badge.icon && badge.description && badge.odds && badge.rule.type, badge.id);
  assert.ok(Number.isInteger(badge.ep) && badge.ep > 0, badge.id);
}
assert.throws(() => evaluateBadges(-1, catalog), RangeError);
assert.throws(() => evaluateBadges(1000001, catalog), RangeError);
assert.throws(() => evaluateBadges(1.5, catalog), RangeError);
assert.equal(matchBadge(byId.get('hello').rule, 107734), true);
assert.equal(matchBadge(byId.get('hello').rule, 7734), false);
assert.equal(matchBadge(byId.get('consec-pair-exact').rule, 1213), true);
assert.equal(matchBadge(byId.get('consec-pair-exact').rule, 12), false);
assert.equal(matchBadge(byId.get('consec-triple-exact').rule, 8910), true);
assert.equal(matchBadge(byId.get('consec-triple-contains').rule, 8910), false);
assert.equal(matchBadge(byId.get('consec-triple-contains').rule, 18910), true);
assert.equal(matchBadge(byId.get('spy').rule, 0), true);
assert.equal(matchBadge(byId.get('spy').rule, 1), false);
assert.equal(matchBadge(byId.get('spy').rule, 2), false);
assert.equal(matchBadge(byId.get('thirteenth-power').rule, 8192), true);

const snapshots = new Map([
  [0, 139927162], [1, 186186584], [2, 119610065], [69, 102135744],
  [777, 103263101], [1000000, 131081274], [111111, 15504537],
  [123456, 11794706], [101112, 650233], [112233, 241735],
  [42069, 50037391], [999999, 23617338],
]);
for (const [value, ep] of snapshots) assert.equal(summarizeRoll(value, catalog, distribution).ep, ep, `EP for ${value}`);
const jackpot = summarizeRoll(777777, catalog, distribution);
const jackpotFamily = jackpot.badges.filter(badge => badge.family === 'JACKPOT');
assert.equal(jackpotFamily.filter(badge => badge.isScoring).length, 1);
assert.equal(jackpotFamily.find(badge => badge.isScoring).id, 'jackpot-six');
assert.equal(jackpotFamily.length, 4);
for (const [percentile, tier] of [[0, 'trash'], [1, 'common'], [50, 'uncommon'], [75, 'rare'], [90, 'epic'], [95, 'anomaly'], [99, 'mythic']]) assert.equal(rollTier(percentile), tier);
assert.equal(scorePercentile(0, distribution), 0);
assert.equal(scorePercentile(186186584, distribution), 99.9999);

/** Optional reference parity uses a local public bundle in a restricted VM. */
function loadReference(filename) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { timeout: 10000 });
  const factories = new Map();
  for (const payload of context.TURBOPACK) {
    let ids = [];
    for (const item of payload.slice(1)) {
      if (typeof item === 'number') ids.push(item);
      else if (typeof item === 'function') {
        for (const id of ids) factories.set(id, item);
        ids = [];
      }
    }
  }
  const cache = new Map();
  const get = id => {
    if (cache.has(id)) return cache.get(id);
    const exports = {};
    cache.set(id, exports);
    factories.get(id)({
      i: get,
      s(items, target = id) {
        const destination = cache.get(target) || {};
        cache.set(target, destination);
        for (let index = 0; index < items.length;) {
          const name = items[index++], type = items[index++];
          destination[name] = type === 0 ? items[index++] : type();
        }
      },
    });
    return exports;
  };
  return { engine: get(710163), definitions: get(167711).BADGE_DEFINITIONS };
}

const referenceArg = process.argv.indexOf('--reference');
const validationValues = new Set(snapshots.keys());
for (let value = 0; value <= 1000; value++) validationValues.add(value);
let sampleSeed = 0x524e4744;
for (let index = 0; index < 10000; index++) {
  sampleSeed = (Math.imul(sampleSeed, 1664525) + 1013904223) >>> 0;
  validationValues.add(sampleSeed % 1000001);
}
if (referenceArg !== -1) {
  const { engine, definitions } = loadReference(path.resolve(root, process.argv[referenceArg + 1]));
  const slug = id => id.toLowerCase().replaceAll('_', '-');
  const values = validationValues;
  for (const [index, definition] of definitions.entries()) {
    const record = byId.get(slug(definition.id));
    assert.equal(record.family, definition.family || null, `Family for ${definition.id}`);
    assert.equal(record.sourceOrder, index, `Tie order for ${definition.id}`);
    assert.equal(record.ep, engine.getBadgeInfo(definition.id).score, `Badge EP for ${definition.id}`);
    for (const value of [...definition.tests.match, ...definition.tests.reject]) if (value >= 0 && value <= 1000000) values.add(value);
  }
  if (process.argv.includes('--exhaustive')) for (let value = 0; value <= 1000000; value++) values.add(value);
  let checked = 0;
  for (const value of values) {
    const original = engine.analyzeNumber(value);
    const actual = summarizeRoll(value, catalog, distribution);
    assert.deepEqual(actual.badges.map(badge => badge.id).sort(), [...original.badges].map(slug).sort(), `Badge matches for ${value}`);
    assert.equal(actual.ep, original.totalScore, `EP for ${value}`);
    assert.deepEqual(actual.badges.filter(badge => badge.isScoring).map(badge => badge.id).sort(), [...original.scoringBadges].map(slug).sort(), `Scoring badges for ${value}`);
    assert.equal(actual.percentile, engine.getPercentileForScore(original.totalScore), `Percentile for ${value}`);
    checked++;
    if (checked % 100000 === 0) console.log(`Reference parity: ${checked} rolls passed`);
  }
  console.log(`Reference parity passed for ${checked} rolls and all ${catalog.length} badge rules.`);
}
const phpArg = process.argv.indexOf('--php');
if (phpArg !== -1) {
  const values = [...validationValues];
  const php = spawnSync(process.argv[phpArg + 1], [path.join(root, 'tests/badges.test.php'), '--json-stdin'], {
    input: JSON.stringify(values), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(php.status, 0, php.stderr || php.stdout);
  const phpResults = JSON.parse(php.stdout);
  for (const actual of phpResults) {
    const expected = summarizeRoll(actual.value, catalog, distribution);
    assert.deepEqual(actual.ids, expected.badges.map(badge => badge.id).sort(), `PHP badge matches for ${actual.value}`);
    assert.deepEqual(actual.scoring, expected.badges.filter(badge => badge.isScoring).map(badge => badge.id).sort(), `PHP scoring badges for ${actual.value}`);
    assert.equal(actual.ep, expected.ep, `PHP EP for ${actual.value}`);
    assert.equal(actual.percentile, expected.percentile, `PHP percentile for ${actual.value}`);
    assert.equal(actual.tier, expected.tier, `PHP tier for ${actual.value}`);
  }
  console.log(`PHP/JS parity passed for ${phpResults.length} rolls.`);
}
console.log('Badge catalog, scoring, boundary, and percentile tests passed.');
