<?php
declare(strict_types=1);

$applicationRoot = getenv('RNGDLE_APP_ROOT') ?: dirname(__DIR__);
require_once $applicationRoot . '/lib/database.php';
require_once $applicationRoot . '/lib/auth.php';
require_once $applicationRoot . '/lib/badges.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function application_state(): array
{
    $user = current_user();
    $history = roll_history($user !== null ? (int) $user['id'] : null, $user === null ? guest_identity() : null);
    $today = gmdate('Y-m-d');
    $todayRoll = isset($history[0]) && $history[0]['day'] === $today ? $history[0] : null;
    $leaderboards = leaderboards();
    return [
        'user' => $user !== null ? public_user($user, true) : null,
        'csrf' => $_SESSION['csrf'],
        'today' => $todayRoll,
        'stats' => roll_statistics($history),
        'history' => $history,
        'leaderboard' => $leaderboards,
        'bestRoll' => $leaderboards['daily'][0]['bestRoll'] ?? null,
        'nextReset' => gmdate('Y-m-d\TH:i:s\Z', strtotime('tomorrow UTC')),
        'day' => $today,
        'serverTime' => utc_now(),
    ];
}

function perform_roll(): array
{
    $user = current_user();
    $db = database();
    // A write lock plus user/day uniqueness protects signed-in daily results.
    $db->exec('BEGIN IMMEDIATE');
    $committed = false;
    try {
        $day = gmdate('Y-m-d');
        $existing = null;
        if ($user !== null) {
            $query = $db->prepare('SELECT * FROM rolls WHERE user_id = ? AND day = ?');
            $query->execute([(int) $user['id'], $day]);
            $existing = $query->fetch();
        }
        if ($existing) {
            $db->exec('COMMIT');
            $committed = true;
            return ['roll' => hydrate_roll($existing), 'alreadyRolled' => true, 'state' => application_state()];
        }
        // Inclusive 0..1,000,000; the browser never chooses or submits the outcome.
        $summary = summarize_roll(random_int(0, 1000000), badge_catalog());
        $created = utc_now();
        if ($user === null) {
            // Guests can roll indefinitely. Save only their latest unclaimed roll
            // each day, preserving account history and keeping storage bounded.
            $db->prepare('DELETE FROM rolls WHERE guest_id = ? AND day = ? AND user_id IS NULL AND claimable = 1')
                ->execute([guest_identity(), $day]);
        }
        $query = $db->prepare('INSERT INTO rolls(user_id, guest_id, day, value, ep, badges_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $query->execute([
            $user !== null ? (int) $user['id'] : null, $user === null ? guest_identity() : null,
            $day, $summary['value'], $summary['totalEP'],
            json_encode($summary['badges'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $created,
        ]);
        $id = (int) $db->lastInsertId();
        $db->exec('COMMIT');
        $committed = true;
        $roll = [
            'id' => $id, 'value' => $summary['value'], 'ep' => $summary['totalEP'],
            'badges' => $summary['badges'], 'createdAt' => $created, 'day' => $day,
            'poem' => null,
            'percentile' => $summary['percentile'], 'tier' => $summary['tier'], 'rarity' => $summary['tier'],
        ];
        return ['roll' => $roll, 'alreadyRolled' => false, 'state' => application_state()];
    } catch (Throwable $error) {
        if (!$committed) {
            $db->exec('ROLLBACK');
        }
        throw $error;
    }
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = $_GET['action'] ?? 'state';
    // Public catalog requests do not create or replace a browser's login session.
    if ($method === 'GET' && $action === 'catalog') {
        $missingPath = $applicationRoot . '/data/missing-badges.json';
        $report = is_file($missingPath) ? json_decode((string) file_get_contents($missingPath), true, 512, JSON_THROW_ON_ERROR) : ['missing' => []];
        respond(['badges' => badge_catalog(), 'missing' => $report['missing'] ?? [], 'report' => $report]);
    }
    start_identity();
    if ($method === 'GET') {
        if ($action === 'state') {
            respond(application_state());
        }
        if ($action === 'profile') {
            $name = validate_username($_GET['username'] ?? '');
            $query = database()->prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
            $query->execute([$name]);
            $user = $query->fetch();
            if (!$user) {
                throw new ApiError('This player was not found.', 404);
            }
            $history = roll_history((int) $user['id']);
            respond(['user' => public_user($user), 'stats' => roll_statistics($history), 'history' => $history]);
        }
        if ($action === 'leaderboard') {
            respond(['leaderboard' => leaderboards()]);
        }
        if ($action === 'history') {
            $user = require_user();
            respond(['history' => roll_history((int) $user['id'])]);
        }
        throw new ApiError('Unknown action.', 404);
    }
    if ($method !== 'POST') {
        header('Allow: GET, POST');
        throw new ApiError('Use GET or POST for this endpoint.', 405);
    }
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if (strlen((string) $raw) > 16384) {
        throw new ApiError('The request is too large.', 413);
    }
    $input = json_decode((string) $raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($input)) {
        throw new ApiError('Send a JSON object.');
    }
    $action = $input['action'] ?? $action;
    require_csrf($input);
    switch ($action) {
        case 'roll':
            respond(perform_roll());

        case 'register':
            limit_requests('register', 5, 3600);
            $username = validate_username($input['username'] ?? null);
            $email = validate_email($input['email'] ?? null);
            $password = validate_password($input['password'] ?? null);
            $db = database();
            try {
                $query = $db->prepare('INSERT INTO users(username, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
                $query->execute([$username, $email, password_hash($password, PASSWORD_DEFAULT), utc_now()]);
            } catch (PDOException $error) {
                if ((string) $error->getCode() === '23000') {
                    throw new ApiError('That username or email is already registered.', 409);
                }
                throw $error;
            }
            sign_in_user((int) $db->lastInsertId());
            $sent = send_account_email(require_user(), 'verify');
            respond([
                'ok' => true, 'emailSent' => $sent,
                'message' => $sent ? 'Account created. Check your email to verify your address.' :
                    'Account created, but the verification email could not be delivered. You can request it again in Settings.',
                'state' => application_state(),
            ], 201);

        case 'login':
            limit_requests('login', 20, 900);
            $identity = is_string($input['identity'] ?? null) ? trim($input['identity']) : '';
            $password = is_string($input['password'] ?? null) ? $input['password'] : '';
            $query = database()->prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE');
            $query->execute([$identity, $identity]);
            $user = $query->fetch();
            // A valid dummy hash reduces timing differences for unknown accounts.
            $hash = $user['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
            if (!password_verify($password, $hash) || !$user) {
                throw new ApiError('The username/email or password is incorrect.', 401);
            }
            if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
                database()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
            }
            sign_in_user((int) $user['id']);
            respond(['ok' => true, 'message' => 'Signed in.', 'state' => application_state()]);

        case 'logout':
            unset($_SESSION['user_id'], $_SESSION['session_version']);
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            respond(['ok' => true, 'message' => 'Signed out.', 'state' => application_state()]);

        case 'resendVerification':
            $user = require_user();
            if ($user['verified_at'] !== null) {
                respond(['ok' => true, 'message' => 'Your email is already verified.']);
            }
            limit_requests('verification', 3, 900, (string) $user['id']);
            if (!send_account_email($user, 'verify')) {
                throw new ApiError('The email could not be delivered. Please try again later.', 503);
            }
            respond(['ok' => true, 'message' => 'Verification email sent.']);

        case 'verifyEmail':
            database()->beginTransaction();
            try {
                $token = consume_account_token('verify', $input['token'] ?? null);
                database()->prepare('UPDATE users SET verified_at = ? WHERE id = ?')->execute([utc_now(), $token['user_id']]);
                database()->commit();
            } catch (Throwable $error) {
                database()->rollBack();
                throw $error;
            }
            respond(['ok' => true, 'message' => 'Email verified.', 'state' => application_state()]);

        case 'requestPasswordReset':
            limit_requests('reset-email', 3, 900);
            $email = validate_email($input['email'] ?? null);
            $query = database()->prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
            $query->execute([$email]);
            $user = $query->fetch();
            if ($user && !send_account_email($user, 'reset')) {
                throw new ApiError('The email service is unavailable. Please try again later.', 503);
            }
            respond(['ok' => true, 'message' => 'If this email is registered, a password reset link has been sent.']);

        case 'resetPassword':
            limit_requests('reset-token', 10, 900);
            $password = validate_password($input['password'] ?? null);
            database()->beginTransaction();
            try {
                $token = consume_account_token('reset', $input['token'] ?? null);
                database()->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $token['user_id']]);
                database()->prepare('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?')->execute([$token['user_id'], 'reset']);
                database()->commit();
            } catch (Throwable $error) {
                database()->rollBack();
                throw $error;
            }
            respond(['ok' => true, 'message' => 'Password reset. You can now sign in.']);

        case 'changePassword':
            $user = require_user();
            limit_requests('account-password', 10, 900, (string) $user['id']);
            confirm_password($user, $input['currentPassword'] ?? null);
            $password = validate_password($input['password'] ?? null);
            database()->prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
            database()->prepare('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?')->execute([$user['id'], 'reset']);
            $_SESSION['session_version'] = (int) $user['session_version'] + 1;
            session_regenerate_id(true);
            respond(['ok' => true, 'message' => 'Password updated.', 'state' => application_state()]);

        case 'changeUsername':
            $user = require_user();
            limit_requests('account-name', 10, 900, (string) $user['id']);
            confirm_password($user, $input['password'] ?? null);
            $name = validate_username($input['username'] ?? null);
            try {
                database()->prepare('UPDATE users SET username = ? WHERE id = ?')->execute([$name, $user['id']]);
            } catch (PDOException $error) {
                if ((string) $error->getCode() === '23000') {
                    throw new ApiError('That username is already registered.', 409);
                }
                throw $error;
            }
            respond(['ok' => true, 'message' => 'Username updated.', 'state' => application_state()]);

        case 'updateProfile':
            $user = require_user();
            $color = $input['nameColor'] ?? $user['name_color'];
            if (!is_string($color) || !preg_match('/^#[a-fA-F0-9]{6}$/D', $color)) {
                throw new ApiError('Choose a valid six-digit hex name color.');
            }
            $favorites = $input['favoriteBadgeIds'] ?? json_decode($user['favorite_badges_json'], true);
            if (!is_array($favorites) || !array_is_list($favorites) || count($favorites) > 2 || count(array_unique($favorites, SORT_REGULAR)) !== count($favorites)) {
                throw new ApiError('Choose up to two different earned favorite badges.');
            }
            $earned = array_column(roll_statistics(roll_history((int) $user['id']))['badges'], 'id');
            foreach ($favorites as $badgeId) {
                if (!is_string($badgeId) || !in_array($badgeId, $earned, true)) {
                    throw new ApiError('Favorite badges must be badges you have earned.');
                }
            }
            database()->prepare('UPDATE users SET name_color = ?, favorite_badges_json = ? WHERE id = ?')->execute([$color, json_encode($favorites, JSON_THROW_ON_ERROR), $user['id']]);
            respond(['ok' => true, 'message' => 'Profile updated.', 'state' => application_state()]);

        case 'savePoem':
            $user = current_user();
            $rollId = $input['rollId'] ?? null;
            $text = $input['text'] ?? null;
            if (!is_int($rollId) || $rollId < 1 || !is_string($text)) {
                throw new ApiError('Choose a roll and enter your poem.');
            }
            $characters = preg_match_all('/./us', $text);
            if ($characters === false || $characters > 300) {
                throw new ApiError('Your poem must contain no more than 300 characters.');
            }
            $query = database()->prepare('SELECT * FROM rolls WHERE id = ?');
            $query->execute([$rollId]);
            $roll = $query->fetch();
            $owned = $roll && ($user !== null
                ? (int) $roll['user_id'] === (int) $user['id']
                : $roll['user_id'] === null && $roll['guest_id'] === guest_identity() && $roll['day'] === gmdate('Y-m-d'));
            if (!$owned) {
                throw new ApiError('You can save a poem only on your own roll.', 403);
            }
            database()->prepare('UPDATE rolls SET poem = ? WHERE id = ?')->execute([trim($text) === '' ? null : trim($text), $rollId]);
            respond(['ok' => true, 'message' => 'Poem saved.', 'state' => application_state()]);

        case 'deleteAccount':
            $user = require_user();
            limit_requests('account-delete', 10, 900, (string) $user['id']);
            confirm_password($user, $input['password'] ?? null);
            database()->beginTransaction();
            try {
                database()->prepare('UPDATE rolls SET claimable = 0, guest_id = NULL, poem = NULL WHERE user_id = ?')->execute([$user['id']]);
                database()->prepare('DELETE FROM users WHERE id = ?')->execute([$user['id']]);
                database()->commit();
            } catch (Throwable $error) {
                database()->rollBack();
                throw $error;
            }
            unset($_SESSION['user_id'], $_SESSION['session_version']);
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            respond(['ok' => true, 'message' => 'Account deleted. Its rolls are retained anonymously.', 'state' => application_state()]);

        default:
            throw new ApiError('Unknown action.', 404);
    }
} catch (ApiError $error) {
    respond(['ok' => false, 'error' => $error->getMessage()], $error->status);
} catch (JsonException $error) {
    respond(['ok' => false, 'error' => 'The request contains invalid JSON.'], 400);
} catch (Throwable $error) {
    error_log('RNGdle API error: ' . get_class($error) . ': ' . $error->getMessage());
    respond(['ok' => false, 'error' => 'The server could not finish this request. Please try again.'], 500);
}
