<?php
// Router for PHP's localhost server. Apache uses .htaccess in production.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false;
}
if (str_contains($path, '..')) {
    http_response_code(404);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
