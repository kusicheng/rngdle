<?php
declare(strict_types=1);

/** Private persistence. Neither the database nor signing key belongs in public/. */
function storage_directory(): string
{
    static $directory;
    if ($directory !== null) {
        return $directory;
    }
    $path = getenv('RNGDLE_STORAGE') ?: dirname(__DIR__) . '/rngdle-storage';
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('The private storage directory could not be created.');
    }
    $resolved = realpath($path);
    $public = realpath(($_SERVER['DOCUMENT_ROOT'] ?? '') ?: dirname(__DIR__) . '/public');
    if ($resolved === false || ($public !== false &&
        (strcasecmp($resolved, $public) === 0 ||
         str_starts_with(strtolower(str_replace('\\', '/', $resolved)), strtolower(str_replace('\\', '/', $public)) . '/')))) {
        throw new RuntimeException('RNGDLE_STORAGE must be outside the public directory.');
    }
    $directory = $resolved;
    return $directory;
}

function application_secret(): string
{
    static $secret;
    if ($secret !== null) {
        return $secret;
    }
    $path = storage_directory() . '/signing-key';
    $file = fopen($path, 'c+b');
    if ($file === false || !flock($file, LOCK_EX)) {
        throw new RuntimeException('The application signing key could not be opened.');
    }
    try {
        $value = stream_get_contents($file);
        if ($value === '') {
            $value = bin2hex(random_bytes(32));
            rewind($file);
            if (fwrite($file, $value) !== strlen($value)) {
                throw new RuntimeException('The application signing key could not be saved.');
            }
            fflush($file);
        }
        if (!is_string($value) || !preg_match('/^[a-f0-9]{64}$/D', $value)) {
            throw new RuntimeException('The application signing key is invalid.');
        }
        $secret = $value;
    } finally {
        flock($file, LOCK_UN);
        fclose($file);
    }
    @chmod($path, 0600);
    return $secret;
}

function database(): PDO
{
    static $connection;
    if ($connection !== null) {
        return $connection;
    }
    $path = storage_directory() . '/rngdle.sqlite';
    $connection = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $connection->exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    $connection->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    verified_at TEXT,
    name_color TEXT NOT NULL DEFAULT '#a5b4fc',
    favorite_badges_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    guest_id TEXT,
    claimable INTEGER NOT NULL DEFAULT 1,
    day TEXT NOT NULL,
    value INTEGER NOT NULL CHECK(value >= 0 AND value <= 1000000),
    ep INTEGER NOT NULL,
    badges_json TEXT NOT NULL,
    poem TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, day),
    UNIQUE(guest_id, day)
);
CREATE INDEX IF NOT EXISTS rolls_day_idx ON rolls(day);
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id, kind);
CREATE TABLE IF NOT EXISTS request_limits (
    bucket TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
SQL);
    // Small, explicit migrations keep existing player data when new fields are added.
    if ((int) $connection->query('PRAGMA user_version')->fetchColumn() < 1) {
        $connection->exec('BEGIN IMMEDIATE');
        try {
            $userColumns = array_column($connection->query('PRAGMA table_info(users)')->fetchAll(), 'name');
            if (!in_array('session_version', $userColumns, true)) {
                $connection->exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
            }
            $rollColumns = array_column($connection->query('PRAGMA table_info(rolls)')->fetchAll(), 'name');
            if (!in_array('claimable', $rollColumns, true)) {
                $connection->exec('ALTER TABLE rolls ADD COLUMN claimable INTEGER NOT NULL DEFAULT 1');
            }
            if (!in_array('poem', $rollColumns, true)) {
                $connection->exec('ALTER TABLE rolls ADD COLUMN poem TEXT');
            }
            $connection->exec('PRAGMA user_version = 1; COMMIT');
        } catch (Throwable $error) {
            $connection->exec('ROLLBACK');
            throw $error;
        }
    }
    @chmod($path, 0600);
    return $connection;
}

function utc_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function badge_catalog(): array
{
    static $catalog;
    if ($catalog === null) {
        $path = dirname(__DIR__) . '/data/badges.json';
        $catalog = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($catalog)) {
            throw new RuntimeException('The badge catalog is invalid.');
        }
    }
    return $catalog;
}

function hydrate_roll(array $row): array
{
    $badges = json_decode($row['badges_json'], true, 512, JSON_THROW_ON_ERROR);
    static $distribution;
    if ($distribution === null) {
        $distribution = json_decode((string) file_get_contents(dirname(__DIR__) . '/data/score-distribution.json'), true, 512, JSON_THROW_ON_ERROR);
    }
    $percentile = score_percentile((int) $row['ep'], $distribution);
    $tier = roll_tier($percentile);
    return [
        'id' => (int) $row['id'],
        'value' => (int) $row['value'],
        'ep' => (int) $row['ep'],
        'badges' => $badges,
        'createdAt' => $row['created_at'],
        'day' => $row['day'],
        'poem' => $row['poem'] ?? null,
        'percentile' => $percentile,
        'tier' => $tier,
        'rarity' => $tier,
    ];
}

function roll_history(?int $userId, ?string $guestId = null): array
{
    if ($userId !== null) {
        $query = database()->prepare('SELECT * FROM rolls WHERE user_id = ? ORDER BY day DESC, id DESC');
        $query->execute([$userId]);
    } elseif ($guestId !== null) {
        $query = database()->prepare('SELECT * FROM rolls WHERE guest_id = ? AND claimable = 1 ORDER BY day DESC, id DESC');
        $query->execute([$guestId]);
    } else {
        return [];
    }
    return array_map('hydrate_roll', $query->fetchAll());
}

function roll_statistics(array $history): array
{
    $totalEP = 0;
    $best = null;
    $collection = [];
    $days = [];
    foreach ($history as $roll) {
        $totalEP += $roll['ep'];
        if ($best === null || $roll['ep'] > $best['ep']) {
            $best = $roll;
        }
        $days[$roll['day']] = true;
        foreach ($roll['badges'] as $badge) {
            $id = $badge['id'];
            if (!isset($collection[$id])) {
                $collection[$id] = array_merge($badge, [
                    'count' => 0, 'firstEarned' => $roll['createdAt'], 'lastEarned' => $roll['createdAt'],
                ]);
            }
            $collection[$id]['count']++;
            $collection[$id]['firstEarned'] = min($collection[$id]['firstEarned'], $roll['createdAt']);
            $collection[$id]['lastEarned'] = max($collection[$id]['lastEarned'], $roll['createdAt']);
        }
    }
    $streak = 0;
    $cursor = gmdate('Y-m-d');
    if (!isset($days[$cursor])) {
        $cursor = gmdate('Y-m-d', strtotime('yesterday UTC'));
    }
    while (isset($days[$cursor])) {
        $streak++;
        $cursor = gmdate('Y-m-d', strtotime($cursor . ' -1 day UTC'));
    }
    $badges = array_values($collection);
    usort($badges, fn(array $a, array $b): int => ($b['ep'] <=> $a['ep']) ?: strcmp($a['name'], $b['name']));
    return [
        'rolls' => count($history),
        'totalEP' => $totalEP,
        'averageEP' => $history ? round($totalEP / count($history), 2) : 0,
        'bestEP' => $best['ep'] ?? 0,
        'bestRoll' => $best,
        'streak' => $streak,
        'uniqueBadges' => count($badges),
        'badges' => $badges,
    ];
}

/** Aggregate real registered-player rolls. Deleted accounts never appear here. */
function leaderboard_rows(?string $fromDay = null, bool $byBadges = false, bool $byAverage = false): array
{
    $where = $fromDay !== null ? ' WHERE r.day >= ?' : '';
    $arguments = $fromDay !== null ? [$fromDay] : [];
    $sql = 'SELECT r.*, u.username, u.name_color, u.favorite_badges_json FROM rolls r JOIN users u ON u.id = r.user_id';
    if (!$byBadges) {
        // Select the top players before fetching their roll/badge details.
        $order = $byAverage ? 'AVG(r.ep) DESC, SUM(r.ep) DESC' : 'SUM(r.ep) DESC';
        $sql = 'WITH ranked_players AS (SELECT r.user_id FROM rolls r JOIN users u ON u.id = r.user_id' . $where .
            ' GROUP BY r.user_id ORDER BY ' . $order . ', MIN(u.username) COLLATE NOCASE ASC LIMIT 100) ' .
            $sql . ' JOIN ranked_players p ON p.user_id = r.user_id';
        $arguments = array_merge($arguments, $arguments);
    }
    $query = database()->prepare($sql . $where);
    $query->execute($arguments);
    $players = [];
    foreach ($query as $roll) {
        $id = (int) $roll['user_id'];
        if (!isset($players[$id])) {
            $players[$id] = [
                'userId' => $id, 'username' => $roll['username'], 'nameColor' => $roll['name_color'],
                'favoriteBadgeIds' => json_decode($roll['favorite_badges_json'], true),
                'totalEP' => 0, 'rolls' => 0, 'bestEP' => 0, 'badgeIds' => [],
                'bestRoll' => null,
            ];
        }
        $players[$id]['totalEP'] += (int) $roll['ep'];
        $players[$id]['rolls']++;
        $players[$id]['bestEP'] = max($players[$id]['bestEP'], (int) $roll['ep']);
        if ($players[$id]['bestRoll'] === null || (int) $roll['ep'] > $players[$id]['bestRoll']['ep']) {
            $players[$id]['bestRoll'] = hydrate_roll($roll);
        }
        foreach (json_decode($roll['badges_json'], true, 512, JSON_THROW_ON_ERROR) as $badge) {
            $players[$id]['badgeIds'][$badge['id']] = true;
        }
    }
    $rows = array_values($players);
    foreach ($rows as &$row) {
        $row['uniqueBadges'] = count($row['badgeIds']);
        unset($row['badgeIds']);
        $row['averageEP'] = round($row['totalEP'] / $row['rolls'], 2);
    }
    unset($row);
    usort($rows, function (array $a, array $b) use ($byBadges, $byAverage): int {
        $metric = $byBadges ? 'uniqueBadges' : ($byAverage ? 'averageEP' : 'totalEP');
        return ($b[$metric] <=> $a[$metric]) ?: ($b['totalEP'] <=> $a['totalEP']) ?: strcasecmp($a['username'], $b['username']);
    });
    $rows = array_slice($rows, 0, 100);
    foreach ($rows as $index => &$row) {
        $row['rank'] = $index + 1;
    }
    return $rows;
}

function leaderboards(): array
{
    $today = gmdate('Y-m-d');
    $week = gmdate('Y-m-d', strtotime('monday this week UTC'));
    return [
        'daily' => leaderboard_rows($today),
        'weekly' => leaderboard_rows($week),
        'allTime' => leaderboard_rows(),
        'badges' => leaderboard_rows(null, true),
        'dailyAverage' => leaderboard_rows($today, false, true),
        'weeklyAverage' => leaderboard_rows($week, false, true),
        'allTimeAverage' => leaderboard_rows(null, false, true),
    ];
}
