<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/badges.php';

$catalog = json_decode(file_get_contents(__DIR__ . '/../data/badges.json'), true, 512, JSON_THROW_ON_ERROR);
$distribution = json_decode(file_get_contents(__DIR__ . '/../data/score-distribution.json'), true, 512, JSON_THROW_ON_ERROR);

function badge_test_equal(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) throw new RuntimeException($message . ': expected ' . json_encode($expected) . ', got ' . json_encode($actual));
}

badge_test_equal(count($catalog), 233, 'Catalog size');
$snapshots = [0 => 139927162, 1 => 186186584, 2 => 119610065, 69 => 102135744, 777 => 103263101, 1000000 => 131081274, 111111 => 15504537, 123456 => 11794706, 101112 => 650233, 112233 => 241735, 42069 => 50037391, 999999 => 23617338];
foreach ($snapshots as $value => $ep) badge_test_equal(summarize_roll($value, $catalog, $distribution)['ep'], $ep, "EP for $value");
badge_test_equal(summarize_roll(777777, $catalog, $distribution)['ep'], 113459927, 'Jackpot Six score');
badge_test_equal(score_percentile(186186584, $distribution), 99.9999, 'Highest score percentile');
badge_test_equal(roll_tier(99), 'mythic', 'Mythic boundary');
badge_test_equal(roll_tier(0), 'trash', 'Trash boundary');
foreach ([-1, 1000001] as $value) {
    try { evaluate_badges($value, $catalog); throw new RuntimeException('Invalid value was accepted'); }
    catch (InvalidArgumentException $error) { /* Expected validation error. */ }
}

// Compact batch output lets the JS suite compare independent implementations.
if (in_array('--json-stdin', $argv, true)) {
    $values = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $results = [];
    foreach ($values as $value) {
        $roll = summarize_roll($value, $catalog, $distribution);
        $ids = array_column($roll['badges'], 'id');
        $scoring = array_column(array_filter($roll['badges'], fn($badge) => $badge['isScoring']), 'id');
        sort($ids); sort($scoring);
        $results[] = ['value' => $value, 'ids' => $ids, 'scoring' => $scoring, 'ep' => $roll['ep'], 'percentile' => $roll['percentile'], 'tier' => $roll['tier']];
    }
    echo json_encode($results, JSON_THROW_ON_ERROR);
} else {
    echo "PHP badge catalog, scoring, boundary, and percentile tests passed.\n";
}
