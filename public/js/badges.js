/**
 * Badge rules live in data/badges.json. Add records there to extend the catalog.
 * Values use ordinary decimal digits, without padding, from 0 to 1,000,000.
 */
export const MAX_ROLL = 1000000;

const digitsOf = (value) => String(value).split("").map(Number);
const countsOf = (text) =>
  [...text].reduce((counts, digit) => {
    counts[digit] = (counts[digit] || 0) + 1;
    return counts;
  }, {});
const sum = (digits) => digits.reduce((total, digit) => total + digit, 0);
const palindrome = (text) => text === [...text].reverse().join("");
const noLeadingZero = (text) => text.length === 1 || text[0] !== "0";
const consecutive = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.slice(1).every((value, index) => value - sorted[index] === 1);
};
const ordered = (numbers) =>
  numbers.slice(1).every((value, index) => value > numbers[index]) ||
  numbers.slice(1).every((value, index) => value < numbers[index]);

/** Try splits from left to right; preserve the original game's first-match rule. */
function findSplit(text, pieces, predicate) {
  const visit = (start, parts) => {
    if (parts.length === pieces - 1) {
      const last = text.slice(start);
      if (!last || !noLeadingZero(last)) return null;
      const result = [...parts, last];
      return predicate(result.map(Number), result) ? result : null;
    }
    const remaining = pieces - parts.length - 1;
    for (let end = start + 1; end <= text.length - remaining; end++) {
      const part = text.slice(start, end);
      if (!noLeadingZero(part)) continue;
      const result = visit(end, [...parts, part]);
      if (result) return result;
    }
    return null;
  };
  return text.length >= pieces ? visit(0, []) : null;
}

function consecutiveSplit(text, rule) {
  const pieces = rule.pieces;
  if (rule.mode === "nearby") {
    const parts = [];
    for (let start = 0; start < text.length; start++) {
      for (let end = start + 1; end <= text.length; end++) {
        const part = text.slice(start, end);
        if (noLeadingZero(part))
          parts.push({ start, end, part, value: Number(part) });
      }
    }
    return parts.some((a, index) =>
      parts
        .slice(index + 1)
        .some(
          (b) =>
            Math.abs(a.value - b.value) === 1 &&
            (a.part.length >= 2 || b.part.length >= 2) &&
            (a.end < b.start || b.end < a.start),
        ),
    );
  }
  if (rule.mode === "contains") {
    for (let start = 0; start < text.length; start++) {
      for (
        let length = 1;
        length <= text.length - start - (pieces - 1);
        length++
      ) {
        const first = text.slice(start, start + length);
        if (!noLeadingZero(first)) continue;
        for (const direction of [1, -1]) {
          let end = start + length;
          const parts = [first];
          for (let index = 1; index < pieces; index++) {
            const value = Number(first) + direction * index;
            if (value < 0) break;
            const next = String(value);
            if (text.slice(end, end + next.length) !== next) break;
            parts.push(next);
            end += next.length;
          }
          if (
            parts.length === pieces &&
            parts.some((part) => part.length >= 2) &&
            !(start === 0 && end === text.length)
          )
            return true;
        }
      }
    }
    return false;
  }
  const result = findSplit(
    text,
    pieces,
    (numbers, parts) =>
      parts.some((part) => part.length >= 2) && consecutive(numbers),
  );
  if (!result) return false;
  return rule.mode === "scrambled"
    ? !ordered(result.map(Number))
    : ordered(result.map(Number));
}

function progressionSplit(text, mode) {
  for (let pieces = 3; pieces <= text.length; pieces++) {
    const result = findSplit(text, pieces, (numbers) => {
      if (mode === "arithmetic") {
        const gap = numbers[1] - numbers[0];
        return (
          Math.abs(gap) > 1 &&
          numbers
            .slice(1)
            .every((value, index) => value - numbers[index] === gap)
        );
      }
      return (
        numbers.every((value) => value > 0) &&
        numbers[0] !== numbers[1] &&
        numbers
          .slice(2)
          .every(
            (value, index) =>
              numbers[index + 1] ** 2 === numbers[index] * value,
          )
      );
    });
    if (result) return true;
  }
  return false;
}

function isPrime(value) {
  if (value <= 1) return false;
  if (value <= 3) return true;
  if (value % 2 === 0 || value % 3 === 0) return false;
  for (let factor = 5; factor * factor <= value; factor += 6) {
    if (value % factor === 0 || value % (factor + 2) === 0) return false;
  }
  return true;
}

function matches(
  rule,
  value,
  text,
  digits,
  counts,
  frequencies = Object.values(counts),
  differences = digits.slice(1).map((digit, index) => digit - digits[index]),
) {
  switch (rule.type) {
    case "equals":
      return rule.values.includes(value);
    case "contains":
      return rule.all
        ? rule.patterns.every((pattern) => text.includes(pattern))
        : rule.patterns.some((pattern) => text.includes(pattern));
    case "suffix":
      return text.endsWith(rule.pattern);
    case "length":
      return text.length === rule.length;
    case "range":
      return value >= rule.min && value <= rule.max;
    case "integerPower":
      return (
        Math.round(value ** (1 / rule.exponent)) ** rule.exponent === value
      );
    case "powerOf": {
      if (value < 1) return false;
      let power = 1;
      while (power < value) power *= rule.base;
      return power === value;
    }
    case "digitSum": {
      const total = sum(digits);
      return rule.relation === ">"
        ? total > rule.value
        : rule.relation === "<"
          ? total < rule.value
          : total === rule.value;
    }
    case "digitCount":
      return (counts[rule.digit] || 0) === rule.count;
    case "frequency":
      return (
        frequencies.filter((count) =>
          rule.atLeast ? count >= rule.count : count === rule.count,
        ).length >= (rule.groups || 1)
      );
    case "uniqueDigits":
      return (
        text.length >= (rule.minLength || 1) &&
        (rule.allDistinct
          ? frequencies.length === text.length
          : frequencies.length === rule.count)
      );
    case "allDigits":
      return [...text].every((digit) => rule.digits.includes(digit));
    case "noDigits":
      return [...text].every((digit) => !rule.digits.includes(digit));
    case "multiple":
      return (!rule.positive || value > 0) && value % rule.divisor === 0;
    case "remainder":
      return value % rule.divisor === rule.remainder;
    case "sameParity":
      return digits.every((digit) => digit % 2 === digits[0] % 2);
    case "alternateParity":
      return (
        text.length >= 2 &&
        differences.every((difference) => Math.abs(difference) % 2 === 1)
      );
    case "palindrome": {
      if (!rule.substring) return palindrome(text);
      for (let length = rule.minLength; length <= text.length; length++) {
        for (let start = 0; start + length <= text.length; start++) {
          if (palindrome(text.slice(start, start + length))) return true;
        }
      }
      return false;
    }
    case "run":
      return [...text].some((digit) =>
        text.includes(digit.repeat(rule.length)),
      );
    case "sequence": {
      const length = rule.whole ? text.length : rule.length;
      if (length < (rule.minLength || 2) || text.length < length) return false;
      for (let start = 0; start + length <= text.length; start++) {
        const gap = digits[start + 1] - digits[start];
        if (Math.abs(gap) !== 1 || (rule.direction && gap !== rule.direction))
          continue;
        if (
          digits
            .slice(start + 1, start + length)
            .every(
              (digit, index) => digit === digits[start] + (index + 1) * gap,
            )
        )
          return true;
      }
      return false;
    }
    case "spacing":
      return (
        text.length >= rule.minLength &&
        differences.every((difference) =>
          rule.absolute
            ? Math.abs(difference) === Math.abs(differences[0])
            : difference === differences[0],
        )
      );
    case "neighborDistance":
      return rule.whole
        ? text.length >= rule.minLength &&
            differences.every((difference) => Math.abs(difference) <= rule.max)
        : differences.some((difference) => Math.abs(difference) === rule.exact);
    case "endpoints": {
      if (text.length < rule.minLength) return false;
      const first = digits[0],
        last = digits.at(-1);
      if (rule.gap !== undefined) return Math.abs(first - last) === rule.gap;
      if (rule.relation === "<") return first < last;
      if (rule.relation === ">") return first > last;
      return (
        first === last &&
        (!rule.differentMiddle ||
          digits.slice(1, -1).some((digit) => digit !== first))
      );
    }
    case "bookends": {
      if (text.length < 4) return false;
      if (rule.mode === "same") return text.slice(0, 2) === text.slice(-2);
      if (rule.mode === "reverse")
        return text.slice(0, 2) === [...text.slice(-2)].reverse().join("");
      return (
        text[0] === text[1] &&
        text.at(-1) === text.at(-2) &&
        text[0] !== text.at(-1)
      );
    }
    case "repeat": {
      if (rule.whole)
        return (
          text.length >= 2 &&
          text.length % 2 === 0 &&
          text.slice(0, text.length / 2) === text.slice(text.length / 2)
        );
      const minLength = rule.length || rule.minLength;
      const maxLength = rule.length || Math.floor(text.length / 2);
      for (let length = minLength; length <= maxLength; length++) {
        for (let start = 0; start + 2 * length <= text.length; start++) {
          const part = text.slice(start, start + length);
          if (
            rule.adjacent
              ? part === text.slice(start + length, start + 2 * length)
              : text.indexOf(part, start + length) !== -1
          )
            return true;
        }
      }
      return false;
    }
    case "monotonic":
      return (
        text.length >= 2 &&
        differences.some((difference) => difference !== 0) &&
        differences.every((difference) =>
          rule.strict
            ? difference * rule.direction > 0
            : difference * rule.direction >= 0,
        )
      );
    case "peak": {
      if (text.length < 3 || (rule.strict && differences.includes(0)))
        return false;
      const directions = differences
        .filter((difference) => difference !== 0)
        .map(Math.sign);
      const pivot = directions.indexOf(-rule.direction);
      return (
        pivot > 0 &&
        directions
          .slice(0, pivot)
          .every((direction) => direction === rule.direction) &&
        directions
          .slice(pivot)
          .every((direction) => direction === -rule.direction)
      );
    }
    case "zigzag": {
      const reduced = rule.ignoreEqual
        ? digits.filter(
            (digit, index) => index === 0 || digit !== digits[index - 1],
          )
        : digits;
      if (reduced.length < rule.minLength) return false;
      const gaps = reduced
        .slice(1)
        .map((digit, index) => digit - reduced[index]);
      return (
        gaps.every((gap) => gap !== 0) &&
        gaps
          .slice(1)
          .every((gap, index) => Math.sign(gap) !== Math.sign(gaps[index]))
      );
    }
    case "framedRun":
      return (
        text.length === rule.length + 2 &&
        [...text.slice(1, -1)].every((digit) => digit === text[1]) &&
        text[0] !== text[1] &&
        text.at(-1) !== text[1]
      );
    case "framedDouble":
      return (
        text.length === 6 &&
        text[1] === text[2] &&
        text[3] === text[4] &&
        text[1] !== text[3] &&
        text[0] !== text[1] &&
        text[5] !== text[3]
      );
    case "adjacentPairs": {
      for (let start = 0; start + 2 * rule.groups <= text.length; start++) {
        const pairedDigits = [];
        for (let group = 0; group < rule.groups; group++) {
          const index = start + 2 * group;
          if (
            text[index] !== text[index + 1] ||
            (rule.exactCount && counts[text[index]] !== 2)
          )
            break;
          pairedDigits.push(text[index]);
        }
        if (
          pairedDigits.length === rule.groups &&
          new Set(pairedDigits).size === rule.groups
        )
          return true;
      }
      return false;
    }
    case "hop": {
      if (frequencies.length < 2) return false;
      for (let start = 0; start + 2 * (rule.count - 1) < text.length; start++) {
        const digit = text[start];
        if (
          !Array.from(
            { length: rule.count },
            (_, index) => text[start + index * 2],
          ).every((value) => value === digit)
        )
          continue;
        if (
          !rule.exact ||
          ((start < 2 || text[start - 2] !== digit) &&
            text[start + rule.count * 2] !== digit)
        )
          return true;
      }
      return false;
    }
    case "scramble": {
      const check = (part) =>
        part.length >= rule.minLength && consecutive(digitsOf(part));
      if (!rule.substring) return check(text);
      for (let length = rule.minLength; length <= text.length; length++) {
        for (let start = 0; start + length <= text.length; start++)
          if (check(text.slice(start, start + length))) return true;
      }
      return false;
    }
    case "consecutiveSplit":
      return consecutiveSplit(text, rule);
    case "progressionSplit":
      return progressionSplit(text, rule.mode);
    case "prime":
      return isPrime(value);
    case "fibonacci": {
      let previous = 0,
        current = 1;
      while (previous < value)
        [previous, current] = [current, previous + current];
      return previous === value;
    }
    case "pronic": {
      const root = Math.floor(Math.sqrt(value));
      return root * (root + 1) === value;
    }
    case "factorial": {
      let factorial = 1,
        factor = 1;
      while (factorial < value) factorial *= ++factor;
      return factorial === value;
    }
    case "harshad":
      return value > 0 && value % sum(digits) === 0;
    case "spy":
      return (
        value !== 1 &&
        value !== 2 &&
        sum(digits) === digits.reduce((product, digit) => product * digit, 1)
      );
    case "boat":
      return (
        frequencies.some((count) => count >= 3) &&
        frequencies.filter((count) => count >= 2).length >= 2
      );
    case "contiguousboat": {
      const runs = text.match(/(.)\1*/g) || [];
      return runs
        .slice(1)
        .some(
          (run, index) =>
            (run.length >= 3 && runs[index].length >= 2) ||
            (run.length >= 2 && runs[index].length >= 3),
        );
    }
    case "firefly":
      return (
        text.length >= 4 && frequencies.length === 2 && frequencies.includes(1)
      );
    case "zipper":
      return (
        text.length >= 2 &&
        frequencies.length === 2 &&
        differences.every((gap) => gap !== 0)
      );
    case "snakeeyes":
      return (
        counts["1"] === 2 &&
        Object.entries(counts).every(
          ([digit, count]) => digit === "1" || count < 2,
        )
      );
    case "balanced":
      return (
        text.length >= 2 &&
        text.length % 2 === 0 &&
        sum(digits.slice(0, text.length / 2)) ===
          sum(digits.slice(text.length / 2))
      );
    case "strobogrammatic": {
      const rotation = { 0: "0", 1: "1", 6: "9", 8: "8", 9: "6" };
      return (
        [...text].every((digit) => digit in rotation) &&
        [...text]
          .reverse()
          .map((digit) => rotation[digit])
          .join("") === text
      );
    }
    case "equation":
      return Boolean(
        findSplit(
          text,
          3,
          ([a, b, c]) =>
            a !== 0 &&
            b !== 0 &&
            c !== 0 &&
            (a + b === c ||
              a - b === c ||
              a * b === c ||
              (a % b === 0 && a / b === c)),
        ),
      );
    default:
      throw new Error(`Unknown badge rule type: ${rule.type}`);
  }
}

function validateValue(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ROLL)
    throw new RangeError("Roll must be an integer from 0 to 1,000,000.");
}

export function matchBadge(rule, value) {
  validateValue(value);
  const text = String(value);
  return matches(rule, value, text, digitsOf(value), countsOf(text));
}

export function evaluateBadges(value, catalog) {
  validateValue(value);
  const text = String(value),
    digits = digitsOf(value),
    counts = countsOf(text);
  const frequencies = Object.values(counts),
    differences = digits.slice(1).map((digit, index) => digit - digits[index]);
  const matched = catalog.filter((badge) =>
    matches(badge.rule, value, text, digits, counts, frequencies, differences),
  );
  const winners = new Map();
  for (const badge of [...matched].sort(
    (a, b) =>
      (a.sourceOrder ?? catalog.indexOf(a)) -
      (b.sourceOrder ?? catalog.indexOf(b)),
  )) {
    if (!badge.family) continue;
    const winner = winners.get(badge.family);
    if (!winner || badge.ep > winner.ep) winners.set(badge.family, badge);
  }
  return matched
    .map((badge) => ({
      ...badge,
      isScoring: !badge.family || winners.get(badge.family) === badge,
    }))
    .sort((a, b) => b.ep - a.ep || a.sourceOrder - b.sourceOrder);
}

const percentileKeys = new WeakMap();
export function scorePercentile(score, distribution) {
  if (!distribution) return 0;
  let keys = percentileKeys.get(distribution);
  if (!keys) {
    keys = Object.keys(distribution)
      .map(Number)
      .sort((a, b) => a - b);
    percentileKeys.set(distribution, keys);
  }
  let low = 0,
    high = keys.length - 1,
    found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (keys[middle] <= score) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found < 0 ? 0 : distribution[keys[found]];
}

export function rollTier(percentile) {
  if (percentile < 1) return "trash";
  if (percentile < 50) return "common";
  if (percentile < 75) return "uncommon";
  if (percentile < 90) return "rare";
  if (percentile < 95) return "epic";
  if (percentile < 99) return "anomaly";
  return "mythic";
}

export function summarizeRoll(value, catalog, distribution) {
  const badges = evaluateBadges(value, catalog);
  const ep = badges.reduce(
    (total, badge) => total + (badge.isScoring ? badge.ep : 0),
    0,
  );
  const percentile = scorePercentile(ep, distribution);
  return {
    value,
    badges,
    ep,
    totalEP: ep,
    bestBadge: badges[0] || null,
    percentile,
    tier: rollTier(percentile),
  };
}
