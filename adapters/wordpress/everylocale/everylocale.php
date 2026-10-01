<?php
/**
 * Plugin Name: EveryLocale
 * Description: Translate WordPress content through your self-hosted EveryLocale workspace, with approval before publication.
 * Version: 0.2.0
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * License: MIT
 * Text Domain: everylocale
 */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/includes/class-connector.php';
EveryLocale_Connector::register();
register_activation_hook(__FILE__, static function () { EveryLocale_Connector::rewrites(); flush_rewrite_rules(); });
register_deactivation_hook(__FILE__, static function () { wp_clear_scheduled_hook('everylocale_sync_post'); flush_rewrite_rules(); });
