<?php
declare(strict_types=1);

/** Badge predicates shared with public/js/badges.js; catalog records are JSON. */
const MAX_ROLL = 1000000;

function badge_digits(string $text): array
{
    return array_map('intval', str_split($text));
}

function badge_counts(string $text): array
{
    return array_count_values(str_split($text));
}

function badge_all(array $items, callable $predicate): bool
{
    foreach ($items as $key => $item) {
        if (!$predicate($item, $key)) return false;
    }
    return true;
}

function badge_any(array $items, callable $predicate): bool
{
    foreach ($items as $key => $item) {
        if ($predicate($item, $key)) return true;
    }
    return false;
}

function badge_no_leading_zero(string $text): bool
{
    return strlen($text) === 1 || $text[0] !== '0';
}

function badge_consecutive(array $numbers): bool
{
    sort($numbers, SORT_NUMERIC);
    for ($index = 1; $index < count($numbers); $index++) {
        if ($numbers[$index] - $numbers[$index - 1] !== 1) return false;
    }
    return true;
}

function badge_ordered(array $numbers): bool
{
    $up = true;
    $down = true;
    for ($index = 1; $index < count($numbers); $index++) {
        if ($numbers[$index] <= $numbers[$index - 1]) $up = false;
        if ($numbers[$index] >= $numbers[$index - 1]) $down = false;
    }
    return $up || $down;
}

/** Splits use nonempty decimal pieces, without leading zeros. */
function badge_find_split(string $text, int $pieces, callable $predicate): ?array
{
    if (strlen($text) < $pieces) return null;
    $visit = function (int $start, array $parts) use (&$visit, $text, $pieces, $predicate): ?array {
        if (count($parts) === $pieces - 1) {
            $last = substr($text, $start);
            if ($last === '' || !badge_no_leading_zero($last)) return null;
            $result = [...$parts, $last];
            return $predicate(array_map('intval', $result), $result) ? $result : null;
        }
        $remaining = $pieces - count($parts) - 1;
        for ($end = $start + 1; $end <= strlen($text) - $remaining; $end++) {
            $part = substr($text, $start, $end - $start);
            if (!badge_no_leading_zero($part)) continue;
            $result = $visit($end, [...$parts, $part]);
            if ($result !== null) return $result;
        }
        return null;
    };
    return $visit(0, []);
}

function badge_consecutive_split(string $text, array $rule): bool
{
    $pieces = $rule['pieces'];
    $length = strlen($text);
    if ($rule['mode'] === 'nearby') {
        $parts = [];
        for ($start = 0; $start < $length; $start++) {
            for ($end = $start + 1; $end <= $length; $end++) {
                $part = substr($text, $start, $end - $start);
                if (badge_no_leading_zero($part)) $parts[] = ['start' => $start, 'end' => $end, 'part' => $part, 'value' => (int)$part];
            }
        }
        foreach ($parts as $index => $a) {
            foreach (array_slice($parts, $index + 1) as $b) {
                if (abs($a['value'] - $b['value']) === 1 && (strlen($a['part']) >= 2 || strlen($b['part']) >= 2) &&
                    ($a['end'] < $b['start'] || $b['end'] < $a['start'])) return true;
            }
        }
        return false;
    }
    if ($rule['mode'] === 'contains') {
        for ($start = 0; $start < $length; $start++) {
            for ($size = 1; $size <= $length - $start - ($pieces - 1); $size++) {
                $first = substr($text, $start, $size);
                if (!badge_no_leading_zero($first)) continue;
                foreach ([1, -1] as $direction) {
                    $end = $start + $size;
                    $parts = [$first];
                    for ($index = 1; $index < $pieces; $index++) {
                        $value = (int)$first + $direction * $index;
                        if ($value < 0) break;
                        $next = (string)$value;
                        if (substr($text, $end, strlen($next)) !== $next) break;
                        $parts[] = $next;
                        $end += strlen($next);
                    }
                    if (count($parts) === $pieces && badge_any($parts, fn($part) => strlen($part) >= 2) &&
                        !($start === 0 && $end === $length)) return true;
                }
            }
        }
        return false;
    }
    $result = badge_find_split($text, $pieces, fn($numbers, $parts) =>
        badge_any($parts, fn($part) => strlen($part) >= 2) && badge_consecutive($numbers));
    if ($result === null) return false;
    $ordered = badge_ordered(array_map('intval', $result));
    return $rule['mode'] === 'scrambled' ? !$ordered : $ordered;
}

function badge_progression_split(string $text, string $mode): bool
{
    for ($pieces = 3; $pieces <= strlen($text); $pieces++) {
        $result = badge_find_split($text, $pieces, function ($numbers) use ($mode) {
            if ($mode === 'arithmetic') {
                $gap = $numbers[1] - $numbers[0];
                if (abs($gap) <= 1) return false;
                for ($index = 1; $index < count($numbers); $index++) {
                    if ($numbers[$index] - $numbers[$index - 1] !== $gap) return false;
                }
                return true;
            }
            if (badge_any($numbers, fn($number) => $number <= 0) || $numbers[0] === $numbers[1]) return false;
            for ($index = 0; $index + 2 < count($numbers); $index++) {
                if ($numbers[$index + 1] ** 2 !== $numbers[$index] * $numbers[$index + 2]) return false;
            }
            return true;
        });
        if ($result !== null) return true;
    }
    return false;
}

function badge_is_prime(int $value): bool
{
    if ($value <= 1) return false;
    if ($value <= 3) return true;
    if ($value % 2 === 0 || $value % 3 === 0) return false;
    for ($factor = 5; $factor * $factor <= $value; $factor += 6) {
        if ($value % $factor === 0 || $value % ($factor + 2) === 0) return false;
    }
    return true;
}

function badge_matches(array $rule, int $value, string $text, array $digits, array $counts, ?array $frequencies = null, ?array $differences = null): bool
{
    $length = strlen($text);
    $frequencies ??= array_values($counts);
    if ($differences === null) {
        $differences = [];
        for ($index = 1; $index < $length; $index++) $differences[] = $digits[$index] - $digits[$index - 1];
    }
    switch ($rule['type']) {
        case 'equals': return in_array($value, $rule['values'], true);
        case 'contains': return !empty($rule['all'])
            ? badge_all($rule['patterns'], fn($pattern) => str_contains($text, $pattern))
            : badge_any($rule['patterns'], fn($pattern) => str_contains($text, $pattern));
        case 'suffix': return str_ends_with($text, $rule['pattern']);
        case 'length': return $length === $rule['length'];
        case 'range': return $value >= $rule['min'] && $value <= $rule['max'];
        case 'integerPower': return (int)(round($value ** (1 / $rule['exponent'])) ** $rule['exponent']) === $value;
        case 'powerOf':
            if ($value < 1) return false;
            $power = 1;
            while ($power < $value) $power *= $rule['base'];
            return $power === $value;
        case 'digitSum':
            $total = array_sum($digits);
            return $rule['relation'] === '>' ? $total > $rule['value'] : ($rule['relation'] === '<' ? $total < $rule['value'] : $total === $rule['value']);
        case 'digitCount': return ($counts[$rule['digit']] ?? 0) === $rule['count'];
        case 'frequency': return count(array_filter($frequencies, fn($count) => !empty($rule['atLeast']) ? $count >= $rule['count'] : $count === $rule['count'])) >= ($rule['groups'] ?? 1);
        case 'uniqueDigits': return $length >= ($rule['minLength'] ?? 1) && (!empty($rule['allDistinct']) ? count($frequencies) === $length : count($frequencies) === $rule['count']);
        case 'allDigits': return badge_all(str_split($text), fn($digit) => str_contains($rule['digits'], $digit));
        case 'noDigits': return badge_all(str_split($text), fn($digit) => !str_contains($rule['digits'], $digit));
        case 'multiple': return (empty($rule['positive']) || $value > 0) && $value % $rule['divisor'] === 0;
        case 'remainder': return $value % $rule['divisor'] === $rule['remainder'];
        case 'sameParity': return badge_all($digits, fn($digit) => $digit % 2 === $digits[0] % 2);
        case 'alternateParity': return $length >= 2 && badge_all($differences, fn($gap) => abs($gap) % 2 === 1);
        case 'palindrome':
            if (empty($rule['substring'])) return $text === strrev($text);
            for ($size = $rule['minLength']; $size <= $length; $size++) {
                for ($start = 0; $start + $size <= $length; $start++) {
                    $part = substr($text, $start, $size);
                    if ($part === strrev($part)) return true;
                }
            }
            return false;
        case 'run': return badge_any(array_keys($counts), fn($digit) => str_contains($text, str_repeat((string)$digit, $rule['length'])));
        case 'sequence':
            $size = !empty($rule['whole']) ? $length : $rule['length'];
            if ($size < ($rule['minLength'] ?? 2) || $length < $size) return false;
            for ($start = 0; $start + $size <= $length; $start++) {
                $gap = $digits[$start + 1] - $digits[$start];
                if (abs($gap) !== 1 || (isset($rule['direction']) && $gap !== $rule['direction'])) continue;
                $valid = true;
                for ($index = 1; $index < $size; $index++) {
                    if ($digits[$start + $index] !== $digits[$start] + $index * $gap) { $valid = false; break; }
                }
                if ($valid) return true;
            }
            return false;
        case 'spacing': return $length >= $rule['minLength'] && badge_all($differences, fn($gap) => !empty($rule['absolute']) ? abs($gap) === abs($differences[0]) : $gap === $differences[0]);
        case 'neighborDistance': return !empty($rule['whole'])
            ? $length >= $rule['minLength'] && badge_all($differences, fn($gap) => abs($gap) <= $rule['max'])
            : badge_any($differences, fn($gap) => abs($gap) === $rule['exact']);
        case 'endpoints':
            if ($length < $rule['minLength']) return false;
            $first = $digits[0]; $last = $digits[$length - 1];
            if (isset($rule['gap'])) return abs($first - $last) === $rule['gap'];
            if ($rule['relation'] === '<') return $first < $last;
            if ($rule['relation'] === '>') return $first > $last;
            return $first === $last && (empty($rule['differentMiddle']) || badge_any(array_slice($digits, 1, -1), fn($digit) => $digit !== $first));
        case 'bookends':
            if ($length < 4) return false;
            if ($rule['mode'] === 'same') return substr($text, 0, 2) === substr($text, -2);
            if ($rule['mode'] === 'reverse') return substr($text, 0, 2) === strrev(substr($text, -2));
            return $text[0] === $text[1] && $text[$length - 1] === $text[$length - 2] && $text[0] !== $text[$length - 1];
        case 'repeat':
            if (!empty($rule['whole'])) return $length >= 2 && $length % 2 === 0 && substr($text, 0, intdiv($length, 2)) === substr($text, intdiv($length, 2));
            $minimum = $rule['length'] ?? $rule['minLength'];
            $maximum = $rule['length'] ?? intdiv($length, 2);
            for ($size = $minimum; $size <= $maximum; $size++) {
                for ($start = 0; $start + 2 * $size <= $length; $start++) {
                    $part = substr($text, $start, $size);
                    if (!empty($rule['adjacent']) ? $part === substr($text, $start + $size, $size) : strpos($text, $part, $start + $size) !== false) return true;
                }
            }
            return false;
        case 'monotonic': return $length >= 2 && badge_any($differences, fn($gap) => $gap !== 0) && badge_all($differences, fn($gap) => $rule['strict'] ? $gap * $rule['direction'] > 0 : $gap * $rule['direction'] >= 0);
        case 'peak':
            if ($length < 3 || ($rule['strict'] && in_array(0, $differences, true))) return false;
            $directions = array_values(array_map(fn($gap) => $gap <=> 0, array_filter($differences, fn($gap) => $gap !== 0)));
            $pivot = array_search(-$rule['direction'], $directions, true);
            return $pivot !== false && $pivot > 0 && badge_all(array_slice($directions, 0, $pivot), fn($direction) => $direction === $rule['direction']) && badge_all(array_slice($directions, $pivot), fn($direction) => $direction === -$rule['direction']);
        case 'zigzag':
            $reduced = $digits;
            if (!empty($rule['ignoreEqual'])) $reduced = array_values(array_filter($digits, fn($digit, $index) => $index === 0 || $digit !== $digits[$index - 1], ARRAY_FILTER_USE_BOTH));
            if (count($reduced) < $rule['minLength']) return false;
            $previous = 0;
            for ($index = 1; $index < count($reduced); $index++) {
                $gap = $reduced[$index] - $reduced[$index - 1];
                if ($gap === 0 || ($previous !== 0 && ($gap <=> 0) === ($previous <=> 0))) return false;
                $previous = $gap;
            }
            return true;
        case 'framedRun': return $length === $rule['length'] + 2 && badge_all(str_split(substr($text, 1, -1)), fn($digit) => $digit === $text[1]) && $text[0] !== $text[1] && $text[$length - 1] !== $text[1];
        case 'framedDouble': return $length === 6 && $text[1] === $text[2] && $text[3] === $text[4] && $text[1] !== $text[3] && $text[0] !== $text[1] && $text[5] !== $text[3];
        case 'adjacentPairs':
            for ($start = 0; $start + 2 * $rule['groups'] <= $length; $start++) {
                $paired = [];
                for ($group = 0; $group < $rule['groups']; $group++) {
                    $index = $start + 2 * $group;
                    if ($text[$index] !== $text[$index + 1] || (!empty($rule['exactCount']) && $counts[$text[$index]] !== 2)) break;
                    $paired[] = $text[$index];
                }
                if (count($paired) === $rule['groups'] && count(array_unique($paired)) === $rule['groups']) return true;
            }
            return false;
        case 'hop':
            if (count($frequencies) < 2) return false;
            for ($start = 0; $start + 2 * ($rule['count'] - 1) < $length; $start++) {
                $digit = $text[$start]; $valid = true;
                for ($index = 1; $index < $rule['count']; $index++) if ($text[$start + 2 * $index] !== $digit) { $valid = false; break; }
                if ($valid && (empty($rule['exact']) || (($start < 2 || $text[$start - 2] !== $digit) && ($text[$start + $rule['count'] * 2] ?? '') !== $digit))) return true;
            }
            return false;
        case 'scramble':
            if (empty($rule['substring'])) return $length >= $rule['minLength'] && badge_consecutive($digits);
            for ($size = $rule['minLength']; $size <= $length; $size++) {
                for ($start = 0; $start + $size <= $length; $start++) if (badge_consecutive(badge_digits(substr($text, $start, $size)))) return true;
            }
            return false;
        case 'consecutiveSplit': return badge_consecutive_split($text, $rule);
        case 'progressionSplit': return badge_progression_split($text, $rule['mode']);
        case 'prime': return badge_is_prime($value);
        case 'fibonacci':
            $previous = 0; $current = 1;
            while ($previous < $value) [$previous, $current] = [$current, $previous + $current];
            return $previous === $value;
        case 'pronic': $root = (int)floor(sqrt($value)); return $root * ($root + 1) === $value;
        case 'factorial':
            $factorial = 1; $factor = 1;
            while ($factorial < $value) $factorial *= ++$factor;
            return $factorial === $value;
        case 'harshad': return $value > 0 && $value % array_sum($digits) === 0;
        case 'spy': return $value !== 1 && $value !== 2 && array_sum($digits) === array_product($digits);
        case 'boat': return badge_any($frequencies, fn($count) => $count >= 3) && count(array_filter($frequencies, fn($count) => $count >= 2)) >= 2;
        case 'contiguousboat':
            preg_match_all('/(.)\1*/', $text, $matches);
            $runs = $matches[0];
            for ($index = 1; $index < count($runs); $index++) {
                if ((strlen($runs[$index]) >= 3 && strlen($runs[$index - 1]) >= 2) || (strlen($runs[$index]) >= 2 && strlen($runs[$index - 1]) >= 3)) return true;
            }
            return false;
        case 'firefly': return $length >= 4 && count($frequencies) === 2 && in_array(1, $frequencies, true);
        case 'zipper': return $length >= 2 && count($frequencies) === 2 && badge_all($differences, fn($gap) => $gap !== 0);
        case 'snakeeyes': return ($counts[1] ?? 0) === 2 && badge_all($counts, fn($count, $digit) => (string)$digit === '1' || $count < 2);
        case 'balanced': return $length >= 2 && $length % 2 === 0 && array_sum(array_slice($digits, 0, intdiv($length, 2))) === array_sum(array_slice($digits, intdiv($length, 2)));
        case 'strobogrammatic':
            $rotation = ['0' => '0', '1' => '1', '6' => '9', '8' => '8', '9' => '6'];
            $rotated = '';
            foreach (str_split(strrev($text)) as $digit) {
                if (!isset($rotation[$digit])) return false;
                $rotated .= $rotation[$digit];
            }
            return $rotated === $text;
        case 'equation': return badge_find_split($text, 3, function ($numbers) {
            [$a, $b, $c] = $numbers;
            return $a !== 0 && $b !== 0 && $c !== 0 && ($a + $b === $c || $a - $b === $c || $a * $b === $c || ($a % $b === 0 && $a / $b == $c));
        }) !== null;
        default: throw new InvalidArgumentException('Unknown badge rule type: ' . $rule['type']);
    }
}

function match_badge(array $rule, int $value): bool
{
    if ($value < 0 || $value > MAX_ROLL) throw new InvalidArgumentException('Roll must be an integer from 0 to 1,000,000.');
    $text = (string)$value;
    return badge_matches($rule, $value, $text, badge_digits($text), badge_counts($text));
}

function evaluate_badges(int $value, array $catalog): array
{
    if ($value < 0 || $value > MAX_ROLL) throw new InvalidArgumentException('Roll must be an integer from 0 to 1,000,000.');
    $text = (string)$value;
    $digits = badge_digits($text);
    $counts = badge_counts($text);
    $frequencies = array_values($counts);
    $differences = [];
    for ($index = 1; $index < strlen($text); $index++) $differences[] = $digits[$index] - $digits[$index - 1];
    $matched = array_values(array_filter($catalog, fn($badge) => badge_matches($badge['rule'], $value, $text, $digits, $counts, $frequencies, $differences)));
    $ordered = $matched;
    usort($ordered, fn($a, $b) => ($a['sourceOrder'] ?? PHP_INT_MAX) <=> ($b['sourceOrder'] ?? PHP_INT_MAX));
    $winners = [];
    foreach ($ordered as $badge) {
        if (empty($badge['family'])) continue;
        $family = $badge['family'];
        if (!isset($winners[$family]) || $badge['ep'] > $winners[$family]['ep']) $winners[$family] = $badge;
    }
    foreach ($matched as &$badge) $badge['isScoring'] = empty($badge['family']) || $winners[$badge['family']]['id'] === $badge['id'];
    unset($badge);
    usort($matched, fn($a, $b) => $b['ep'] <=> $a['ep'] ?: ($a['sourceOrder'] ?? PHP_INT_MAX) <=> ($b['sourceOrder'] ?? PHP_INT_MAX));
    return $matched;
}

function score_percentile(int $score, array $distribution): float
{
    if (isset($distribution[$score])) return (float)$distribution[$score];
    $keys = array_keys($distribution);
    $low = 0; $high = count($keys) - 1; $found = -1;
    while ($low <= $high) {
        $middle = ($low + $high) >> 1;
        if ((int)$keys[$middle] <= $score) { $found = $middle; $low = $middle + 1; }
        else $high = $middle - 1;
    }
    return $found < 0 ? 0.0 : (float)$distribution[$keys[$found]];
}

function roll_tier(float $percentile): string
{
    if ($percentile < 1) return 'trash';
    if ($percentile < 50) return 'common';
    if ($percentile < 75) return 'uncommon';
    if ($percentile < 90) return 'rare';
    if ($percentile < 95) return 'epic';
    if ($percentile < 99) return 'anomaly';
    return 'mythic';
}

function summarize_roll(int $value, array $catalog, ?array $distribution = null): array
{
    if ($distribution === null) {
        static $default_distribution;
        if ($default_distribution === null) $default_distribution = json_decode(file_get_contents(__DIR__ . '/../data/score-distribution.json'), true, 512, JSON_THROW_ON_ERROR);
        $distribution = $default_distribution;
    }
    $badges = evaluate_badges($value, $catalog);
    $ep = array_sum(array_map(fn($badge) => $badge['isScoring'] ? $badge['ep'] : 0, $badges));
    $percentile = score_percentile($ep, $distribution);
    return ['value' => $value, 'badges' => $badges, 'ep' => $ep, 'totalEP' => $ep, 'bestBadge' => $badges[0] ?? null, 'percentile' => $percentile, 'tier' => roll_tier($percentile)];
}
