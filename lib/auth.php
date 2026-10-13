<?php
declare(strict_types=1);

final class ApiError extends RuntimeException
{
    public function __construct(string $message, public int $status = 400)
    {
        parent::__construct($message);
    }
}

function is_https(): bool
{
    return !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
}

function start_identity(): void
{
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '2592000');
    session_name('rngdle_session');
    session_set_cookie_params([
        'lifetime' => 2592000, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    guest_identity();
}

/** A signed, durable guest cookie enforces one guest roll per UTC day. */
function guest_identity(): string
{
    static $identity;
    if ($identity !== null) {
        return $identity;
    }
    $cookie = $_COOKIE['rngdle_guest'] ?? '';
    if (is_string($cookie) && preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/D', $cookie, $parts) &&
        hash_equals(hash_hmac('sha256', $parts[1], application_secret()), $parts[2])) {
        $identity = $parts[1];
    } else {
        $identity = bin2hex(random_bytes(16));
        $cookie = $identity . '.' . hash_hmac('sha256', $identity, application_secret());
        setcookie('rngdle_guest', $cookie, [
            'expires' => time() + 315360000, 'path' => '/', 'secure' => is_https(),
            'httponly' => true, 'samesite' => 'Lax',
        ]);
        $_COOKIE['rngdle_guest'] = $cookie;
    }
    return $identity;
}

function require_csrf(array $input): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($input['csrf'] ?? '');
    if (!is_string($token) || !hash_equals($_SESSION['csrf'] ?? '', $token)) {
        throw new ApiError('Your session expired. Reload the page and try again.', 403);
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $query = database()->prepare('SELECT * FROM users WHERE id = ?');
    $query->execute([(int) $_SESSION['user_id']]);
    $user = $query->fetch();
    if (!$user || (int) $user['session_version'] !== (int) ($_SESSION['session_version'] ?? 0)) {
        unset($_SESSION['user_id'], $_SESSION['session_version']);
        return null;
    }
    return $user;
}

function require_user(): array
{
    $user = current_user();
    if ($user === null) {
        throw new ApiError('Please sign in to use this feature.', 401);
    }
    return $user;
}

function public_user(array $user, bool $private = false): array
{
    $result = [
        'id' => (int) $user['id'], 'username' => $user['username'],
        'verified' => $user['verified_at'] !== null,
        'nameColor' => $user['name_color'],
        'favoriteBadgeIds' => json_decode($user['favorite_badges_json'], true),
        'createdAt' => $user['created_at'],
    ];
    if ($private) {
        $result['email'] = $user['email'];
    }
    return $result;
}

function validate_username(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^[a-zA-Z0-9_]{3,24}$/D', $value)) {
        throw new ApiError('Use 3–24 letters, numbers, or underscores for your username.');
    }
    return $value;
}

function validate_email(mixed $value): string
{
    $email = is_string($value) ? strtolower(trim($value)) : '';
    if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ApiError('Enter a valid email address.');
    }
    return $email;
}

function validate_password(mixed $value): string
{
    if (!is_string($value) || strlen($value) < 8 || strlen($value) > 72 || str_contains($value, "\0")) {
        throw new ApiError('Your password must contain 8–72 UTF-8 bytes and no null characters.');
    }
    return $value;
}

function confirm_password(array $user, mixed $password): void
{
    if (!is_string($password) || !password_verify($password, $user['password_hash'])) {
        throw new ApiError('Your current password is incorrect.', 403);
    }
}

/** Limits are hashed; email addresses and IP addresses are not stored here. */
function limit_requests(string $scope, int $maximum, int $seconds, string $identity = ''): void
{
    $slot = intdiv(time(), $seconds);
    $bucket = hash_hmac('sha256', $scope . ':' . ($_SERVER['REMOTE_ADDR'] ?? '') . ':' . $identity . ':' . $slot, application_secret());
    $query = database()->prepare('INSERT INTO request_limits(bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1');
    $query->execute([$bucket, ($slot + 1) * $seconds]);
    $query = database()->prepare('SELECT attempts FROM request_limits WHERE bucket = ?');
    $query->execute([$bucket]);
    if ((int) $query->fetchColumn() > $maximum) {
        throw new ApiError('Too many attempts. Please wait a few minutes and try again.', 429);
    }
    if (random_int(1, 100) === 1) {
        database()->prepare('DELETE FROM request_limits WHERE expires_at < ?')->execute([time() - 86400]);
        database()->prepare('DELETE FROM auth_tokens WHERE expires_at < ?')->execute([time()]);
    }
}

function migrate_guest_rolls(int $userId): void
{
    $db = database();
    $query = $db->prepare('UPDATE rolls SET user_id = ? WHERE guest_id = ? AND user_id IS NULL AND claimable = 1 AND day NOT IN (SELECT day FROM rolls WHERE user_id = ?)');
    $query->execute([$userId, guest_identity(), $userId]);
    // Keep guest_id: signing out or switching accounts cannot reroll this device today.
}

function sign_in_user(int $userId): void
{
    database()->beginTransaction();
    try {
        migrate_guest_rolls($userId);
        database()->commit();
    } catch (Throwable $error) {
        database()->rollBack();
        throw $error;
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $query = database()->prepare('SELECT session_version FROM users WHERE id = ?');
    $query->execute([$userId]);
    $_SESSION['session_version'] = (int) $query->fetchColumn();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function application_url(): string
{
    $configured = getenv('RNGDLE_URL');
    if ($configured) {
        return rtrim($configured, '/');
    }
    $host = $_SERVER['HTTP_HOST'] ?? 'kevincheng.web.illinois.edu';
    // Do not turn arbitrary Host headers into password-reset links.
    if (!preg_match('/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/D', $host) && $host !== 'kevincheng.web.illinois.edu') {
        $host = 'kevincheng.web.illinois.edu';
    }
    $path = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api.php'));
    return (is_https() ? 'https://' : 'http://') . $host . ($path === '/' || $path === '.' ? '' : $path);
}

function send_account_email(array $user, string $kind): bool
{
    $token = bin2hex(random_bytes(32));
    $db = database();
    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?')->execute([$user['id'], $kind]);
        $db->prepare('INSERT INTO auth_tokens(token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)')->execute([
            hash('sha256', $token), $user['id'], $kind, time() + ($kind === 'verify' ? 86400 : 3600),
        ]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    $verify = $kind === 'verify';
    $link = application_url() . '/?action=' . ($verify ? 'verifyEmail' : 'resetPassword') . '&token=' . rawurlencode($token);
    $subject = $verify ? 'Verify your RNGdle account' : 'Reset your RNGdle password';
    $message = ($verify ? 'Confirm your email address' : 'Choose a new password') . " by opening this link:\n\n" . $link .
        "\n\nThis link expires in " . ($verify ? '24 hours.' : '1 hour.') . "\nIf you did not request this, ignore this email.\n";
    if (getenv('RNGDLE_DEV') === '1') {
        $path = storage_directory() . '/mail.log';
        $saved = file_put_contents($path, utc_now() . ' ' . $user['email'] . ' ' . $subject . "\n" . $message . "\n", FILE_APPEND | LOCK_EX);
        @chmod($path, 0600);
        return $saved !== false;
    }
    $from = getenv('RNGDLE_MAIL_FROM') ?: 'no-reply@kevincheng.web.illinois.edu';
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('RNGDLE_MAIL_FROM must be a valid email address.');
    }
    return function_exists('mail') && @mail($user['email'], $subject, $message, 'From: RNGdle <' . $from . ">\r\nContent-Type: text/plain; charset=UTF-8");
}

function consume_account_token(string $kind, mixed $token): array
{
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) {
        throw new ApiError('This link is invalid or has expired.');
    }
    $query = database()->prepare('SELECT t.*, u.password_hash FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.kind = ? AND t.expires_at > ?');
    $query->execute([hash('sha256', $token), $kind, time()]);
    $row = $query->fetch();
    if (!$row) {
        throw new ApiError('This link is invalid or has expired.');
    }
    database()->prepare('DELETE FROM auth_tokens WHERE token_hash = ?')->execute([$row['token_hash']]);
    return $row;
}
