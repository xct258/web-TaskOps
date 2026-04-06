<?php
declare(strict_types=1);

// ============ CORS ============
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ============ 配置区域 ============
const AUTH_CONFIG_FILE = __DIR__ . '/.auth_users.json';
const AUTH_TOKENS_FILE = __DIR__ . '/.auth_tokens.json';
const AUTH_TOKEN_EXPIRE = 30 * 24 * 3600; // 记住登录有效期：30 天

// 默认账户（仅在 .auth_users.json 不存在时使用，首次运行自动生成哈希文件）
const AUTH_DEFAULT_USERS = [
    'xct258' => 'xct258',
];
// ==================================

// ── 用户加载 ──
function loadAuthUsers(): array
{
    if (file_exists(AUTH_CONFIG_FILE)) {
        $data = json_decode(file_get_contents(AUTH_CONFIG_FILE), true);
        if (is_array($data) && $data !== []) {
            return $data;
        }
    }
    $hashed = [];
    foreach (AUTH_DEFAULT_USERS as $user => $plain) {
        $hashed[$user] = password_hash($plain, PASSWORD_DEFAULT);
    }
    file_put_contents(
        AUTH_CONFIG_FILE,
        json_encode($hashed, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );
    return $hashed;
}

// ── Token 存储（每设备独立） ──
function loadTokens(): array
{
    if (!file_exists(AUTH_TOKENS_FILE)) return [];
    $data = json_decode(file_get_contents(AUTH_TOKENS_FILE), true);
    return is_array($data) ? $data : [];
}

function saveTokens(array $tokens): void
{
    file_put_contents(AUTH_TOKENS_FILE, json_encode($tokens, JSON_PRETTY_PRINT));
}

function purgeExpiredTokens(array &$tokens): void
{
    $now = time();
    $tokens = array_filter($tokens, function ($entry) use ($now) {
        return isset($entry['exp']) && $entry['exp'] > $now;
    });
}

function createToken(string $username): string
{
    $tokens = loadTokens();
    purgeExpiredTokens($tokens);

    // 生成随机 token，服务端只存哈希
    $rawToken = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $rawToken);

    $tokens[$tokenHash] = [
        'user'    => $username,
        'exp'     => time() + AUTH_TOKEN_EXPIRE,
        'created' => time(),
    ];

    saveTokens($tokens);
    return $rawToken;
}

function checkToken(string $rawToken): ?string
{
    if ($rawToken === '') return null;

    $tokenHash = hash('sha256', $rawToken);
    $tokens = loadTokens();

    if (!isset($tokens[$tokenHash])) return null;

    $entry = $tokens[$tokenHash];
    if (time() > ($entry['exp'] ?? 0)) {
        // 已过期 → 清理
        unset($tokens[$tokenHash]);
        saveTokens($tokens);
        return null;
    }

    return $entry['user'] ?? null;
}

function revokeToken(string $rawToken): void
{
    if ($rawToken === '') return;

    $tokenHash = hash('sha256', $rawToken);
    $tokens = loadTokens();

    if (isset($tokens[$tokenHash])) {
        unset($tokens[$tokenHash]);
        saveTokens($tokens);
    }
}

// ── 路由 ──
$AUTH_USERS = loadAuthUsers();

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        handleLogin();
        break;
    case 'check':
        handleCheck();
        break;
    case 'logout':
        handleLogout();
        break;
    default:
        jsonOut(['error' => 'Invalid action'], 400);
}

function handleLogin(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonOut(['error' => 'Method not allowed'], 405);
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $remember = !empty($input['remember']);

    if ($username === '' || $password === '') {
        jsonOut(['error' => '用户名和密码不能为空'], 401);
    }

    global $AUTH_USERS;
    $hash  = $AUTH_USERS[$username] ?? '$2y$10$00000000000000000000000000000000000000000000000000000';
    $valid = password_verify($password, $hash) && isset($AUTH_USERS[$username]);

    if (!$valid) {
        jsonOut(['error' => '用户名或密码错误'], 401);
    }

    $result = ['success' => true, 'username' => $username];

    // 勾选「记住登录」→ 生成设备 token（每次登录独立）
    if ($remember) {
        $result['token'] = createToken($username);
    }

    jsonOut($result);
}

function handleCheck(): void
{
    $rawToken = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

    if ($rawToken === '') {
        jsonOut(['authenticated' => false], 401);
        return;
    }

    $username = checkToken($rawToken);
    if ($username === null) {
        jsonOut(['authenticated' => false], 401);
        return;
    }

    jsonOut(['authenticated' => true, 'username' => $username]);
}

function handleLogout(): void
{
    // 只注销当前设备的 token
    $rawToken = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    revokeToken($rawToken);
    jsonOut(['success' => true]);
}

function jsonOut(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
