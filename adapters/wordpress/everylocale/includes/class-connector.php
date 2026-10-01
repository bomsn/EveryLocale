<?php
if (!defined('ABSPATH')) { exit; }

/** WordPress owns permissions and publishing; EveryLocale owns translation and approval. */
final class EveryLocale_Connector {
    private const OPTION = 'everylocale_settings';
    private const DEFAULTS = ['url' => '', 'token' => '', 'project' => '', 'source_locale' => 'en', 'locales' => 'ar,zh-Hant-TW,de,es,fr'];

    public static function register(): void {
        add_action('admin_menu', [self::class, 'menu']);
        add_action('admin_init', [self::class, 'settings']);
        add_action('init', [self::class, 'rewrites']);
        add_action('save_post', [self::class, 'saved'], 20, 3);
        add_action('before_delete_post', [self::class, 'withdraw']);
        add_action('transition_post_status', [self::class, 'transition'], 20, 3);
        add_action('everylocale_sync_post', [self::class, 'sync']);
        add_action('everylocale_withdraw_post', [self::class, 'deliver_withdrawal']);
        // Resolve localized routes before WordPress guesses an English canonical for a missing slug.
        add_action('template_redirect', [self::class, 'redirect_old_slug'], 1);
        add_action('template_redirect', [self::class, 'sitemap'], 2);
        add_action('template_redirect', [self::class, 'unavailable'], 3);
        add_filter('query_vars', static function (array $vars): array { $vars[] = 'el_locale'; $vars[] = 'el_sitemap'; return $vars; });
        add_action('pre_get_posts', [self::class, 'filter_query']);
        add_filter('rest_post_collection_params', static function (array $params): array { $params['el_locale'] = ['type' => 'string', 'enum' => array_merge([self::config()['source_locale']], self::locales())]; return $params; });
        add_filter('rest_post_query', [self::class, 'rest_query'], 10, 2);
        add_filter('wp_sitemaps_posts_query_args', [self::class, 'sitemap_query']);
        add_filter('post_link', [self::class, 'permalink'], 10, 2);
        add_filter('language_attributes', [self::class, 'language_attributes']);
        add_action('wp_head', [self::class, 'alternate_links']);
        add_shortcode('everylocale_switcher', [self::class, 'switcher']);
        add_filter('the_content', [self::class, 'localized_links'], 30);
        add_filter('rest_prepare_post', static function (WP_REST_Response $response, WP_Post $post): WP_REST_Response {
            $data = $response->get_data();
            if (isset($data['content']['rendered'])) { $data['content']['rendered'] = self::localized_links($data['content']['rendered'], $post); $response->set_data($data); }
            return $response;
        }, 30, 2);
        foreach (['_everylocale_locale', '_everylocale_source_revision', '_everylocale_approval_revision'] as $key) {
            register_post_meta('post', $key, ['type' => 'string', 'single' => true, 'show_in_rest' => true, 'auth_callback' => static fn(): bool => current_user_can('edit_posts')]);
        }
        register_post_meta('post', '_everylocale_source_id', ['type' => 'integer', 'single' => true, 'show_in_rest' => true, 'auth_callback' => static fn(): bool => current_user_can('edit_posts')]);
    }

    private static function config(): array { return array_merge(self::DEFAULTS, (array) get_option(self::OPTION, [])); }
    private static function locales(): array {
        return array_values(array_unique(array_filter(array_map('trim', explode(',', self::config()['locales'])))));
    }
    private static function prefix(string $locale): string { return $locale === 'zh-Hant-TW' ? 'zh-tw' : strtolower($locale); }
    private static function namespace(int $id, string $part): string { return 'wp:post:' . $id . ':' . $part; }
    private static function ready(): bool {
        $settings = self::config();
        return $settings['url'] !== '' && $settings['token'] !== '' && $settings['project'] !== '';
    }
    public static function menu(): void { add_options_page('EveryLocale', 'EveryLocale', 'manage_options', 'everylocale', [self::class, 'page']); }
    public static function settings(): void {
        register_setting('everylocale', self::OPTION, ['type' => 'array', 'sanitize_callback' => [self::class, 'sanitize']]);
    }
    public static function sanitize(array $input): array {
        $previous = self::config();
        $url = esc_url_raw(trim((string) ($input['url'] ?? '')));
        $parsed = wp_parse_url($url);
        if ($url !== '' && (!$parsed || !in_array($parsed['scheme'] ?? '', ['http', 'https'], true) || isset($parsed['user']) || isset($parsed['pass']) || isset($parsed['query']) || isset($parsed['fragment']))) {
            add_settings_error(self::OPTION, 'url', 'Use an HTTP or HTTPS service URL without credentials or query parameters.');
            return $previous;
        }
        $project = sanitize_key((string) ($input['project'] ?? ''));
        $source = trim((string) ($input['source_locale'] ?? 'en'));
        $locales = array_values(array_unique(array_filter(array_map('trim', explode(',', (string) ($input['locales'] ?? ''))))));
        foreach (array_merge([$source], $locales) as $locale) {
            if (!preg_match('/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/', $locale)) {
                add_settings_error(self::OPTION, 'locale', 'Use valid language codes.'); return $previous;
            }
        }
        $token = trim((string) ($input['token'] ?? ''));
        $result = ['url' => rtrim($url, '/'), 'project' => $project, 'source_locale' => $source, 'locales' => implode(',', $locales), 'token' => $token !== '' ? $token : $previous['token']];
        if ($previous['locales'] !== $result['locales']) { update_option('everylocale_flush_rewrites', 1, false); }
        return $result;
    }
    public static function page(): void {
        if (!current_user_can('manage_options')) { return; }
        $settings = self::config();
        echo '<div class="wrap"><h1>EveryLocale</h1><p>Connect your self-hosted translation workspace. Published source posts are queued automatically. Translations follow the project\'s automatic approval or human review gate.</p><form method="post" action="options.php">';
        settings_fields('everylocale');
        echo '<table class="form-table">';
        foreach (['url' => 'Workspace URL', 'project' => 'Project identifier', 'source_locale' => 'Source language', 'locales' => 'Target language codes'] as $key => $label) {
            echo '<tr><th><label for="el-' . esc_attr($key) . '">' . esc_html($label) . '</label></th><td><input class="regular-text" id="el-' . esc_attr($key) . '" name="' . self::OPTION . '[' . esc_attr($key) . ']" value="' . esc_attr($settings[$key]) . '" /></td></tr>';
        }
        echo '<tr><th><label for="el-token">Scoped project token</label></th><td><input class="regular-text" id="el-token" type="password" name="' . self::OPTION . '[token]" value="" autocomplete="new-password" /><p class="description">Leave blank to keep the saved token. Grant read, import, translate, and export only. Never grant approval to this connector.</p></td></tr></table>';
        submit_button(); echo '</form>';
        if ($settings['url']) { echo '<p><a class="button" target="_blank" rel="noopener noreferrer" href="' . esc_url($settings['url']) . '">Open translation review</a></p>'; }
        echo '<p>Add <code>[everylocale_switcher]</code> to show links to published article translations.</p></div>';
    }
    private static function request(string $path, string $method = 'GET', ?array $body = null, ?string $key = null) {
        $settings = self::config();
        $headers = ['Authorization' => 'Bearer ' . $settings['token'], 'Content-Type' => 'application/json'];
        if ($key !== null) { $headers['Idempotency-Key'] = $key; }
        $options = ['method' => $method, 'headers' => $headers, 'timeout' => 10, 'redirection' => 0, 'sslverify' => true];
        if ($body !== null) { $options['body'] = wp_json_encode($body); }
        // The endpoint is configured only by site administrators. Private-network self-hosting is intentional.
        $response = wp_remote_request($settings['url'] . '/api/v1/projects/' . rawurlencode($settings['project']) . $path, $options);
        if (is_wp_error($response)) { return $response; }
        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) { return new WP_Error('everylocale_http', 'Workspace returned HTTP ' . $status); }
        $decoded = json_decode(wp_remote_retrieve_body($response), true);
        return is_array($decoded) ? $decoded : new WP_Error('everylocale_json', 'Invalid workspace response');
    }
    private static function metadata(WP_Post $post): array {
        $fields = ['title' => $post->post_title, 'excerpt' => $post->post_excerpt, 'slug' => $post->post_name, 'seo' => [], 'categories' => [], 'tags' => []];
        foreach (apply_filters('everylocale_metadata_fields', ['_yoast_wpseo_title', '_yoast_wpseo_metadesc', 'rank_math_title', 'rank_math_description'], $post->ID) as $key) {
            $value = get_post_meta($post->ID, $key, true); if (is_string($value) && $value !== '') { $fields['seo'][$key] = $value; }
        }
        foreach (['category' => 'categories', 'post_tag' => 'tags'] as $taxonomy => $field) {
            $terms = wp_get_post_terms($post->ID, $taxonomy);
            if (!is_wp_error($terms)) { foreach ($terms as $term) { $fields[$field][(string) $term->term_id] = $term->name; } }
        }
        return $fields;
    }
    private static function source_revision(WP_Post $post): string { return hash('sha256', wp_json_encode([$post->post_content, self::metadata($post)])); }
    private static function schedule(int $id, int $delay = 5): void {
        if (!wp_next_scheduled('everylocale_sync_post', [$id])) { wp_schedule_single_event(time() + $delay, 'everylocale_sync_post', [$id]); }
    }
    public static function saved(int $id, WP_Post $post, bool $update): void {
        if (!self::ready() || $post->post_type !== 'post' || wp_is_post_revision($id) || wp_is_post_autosave($id) || get_post_meta($id, '_everylocale_source_id', true)) { return; }
        if ($post->post_status === 'publish') { self::schedule($id); }
    }
    public static function transition(string $new, string $old, WP_Post $post): void {
        if ($old === 'publish' && $new !== 'publish' && !get_post_meta($post->ID, '_everylocale_source_id', true)) { self::withdraw($post->ID); }
    }
    private static function translations(int $sourceId): array {
        return get_posts(['post_type' => 'post', 'post_status' => ['publish', 'draft', 'pending', 'private', 'trash'], 'numberposts' => -1, 'meta_key' => '_everylocale_source_id', 'meta_value' => $sourceId]);
    }
    public static function withdraw(int $id): void {
        if (get_post_meta($id, '_everylocale_source_id', true)) { return; }
        foreach (self::translations($id) as $post) { if ($post->post_status === 'publish') { wp_update_post(['ID' => $post->ID, 'post_status' => 'draft']); } }
        $units = get_post_meta($id, '_everylocale_units', true);
        if (self::ready() && is_array($units) && $units) {
            // An option survives deletion of the source post and its metadata.
            update_option('everylocale_withdraw_' . $id, $units, false);
            self::deliver_withdrawal($id);
        }
    }
    public static function deliver_withdrawal(int $id): bool {
        $units = get_option('everylocale_withdraw_' . $id);
        if (!is_array($units) || !$units) { return true; }
        $response = self::ready() ? self::request('/withdraw', 'POST', ['unitIds' => $units]) : new WP_Error('everylocale_configuration', 'Configure the workspace to deliver pending withdrawal.');
        if (is_wp_error($response)) {
            if (!wp_next_scheduled('everylocale_withdraw_post', [$id])) { wp_schedule_single_event(time() + 120, 'everylocale_withdraw_post', [$id]); }
            return false;
        }
        delete_option('everylocale_withdraw_' . $id); return true;
    }
    public static function sync(int $id): void {
        if (!self::ready()) { return; }
        $lock = 'everylocale_lock_' . $id;
        $held = (int) get_option($lock, 0);
        if ($held && $held < time() - 180) { delete_option($lock); }
        if (!add_option($lock, time(), '', false)) { return; }
        try { self::sync_locked($id); } finally { delete_option($lock); }
    }
    private static function sync_locked(int $id): void {
        $post = get_post($id);
        if (!$post || $post->post_status !== 'publish') { self::withdraw($id); return; }
        if (get_post_meta($id, '_everylocale_source_id', true)) { return; }
        if (!self::deliver_withdrawal($id)) { self::schedule($id, 120); return; }
        $project = self::request('');
        if (is_wp_error($project)) { self::error($id, $project); return; }
        $context = hash('sha256', wp_json_encode([$project['glossary'] ?? [], $project['instructions'] ?? [], $project['pipelineRevision'] ?? '', self::locales(), $project['approvalMode'] ?? 'human']));
        $revision = self::source_revision($post);
        $state = get_post_meta($id, '_everylocale_sync', true);
        if (!is_array($state) || ($state['revision'] ?? '') !== $revision || ($state['context'] ?? '') !== $context) {
            $documents = ['metadata' => ['format' => 'json', 'content' => wp_json_encode(self::metadata($post))], 'content' => ['format' => 'html', 'content' => $post->post_content]];
            $units = []; $revisions = [];
            foreach ($documents as $part => $document) {
                $response = self::request('/documents', 'POST', $document + ['namespace' => self::namespace($id, $part)]);
                if (is_wp_error($response)) { self::error($id, $response); return; }
                $units = array_merge($units, $response['units']); $revisions[$part] = $response['sourceRevision'];
            }
            update_post_meta($id, '_everylocale_units', $units);
            $response = self::request('/jobs', 'POST', ['unitIds' => $units, 'locales' => self::locales()], 'wp:' . $id . ':' . $revision . ':' . $context);
            if (is_wp_error($response)) { self::error($id, $response); return; }
            $state = ['revision' => $revision, 'context' => $context, 'documents' => $revisions]; update_post_meta($id, '_everylocale_sync', $state);
        }
        $existing = []; foreach (self::translations($id) as $translated) { $existing[get_post_meta($translated->ID, '_everylocale_locale', true)] = $translated; }
        $waiting = false;
        foreach (self::locales() as $locale) {
            if (!isset($existing[$locale])) {
                $draft = wp_insert_post(['post_type' => 'post', 'post_status' => 'draft', 'post_title' => $post->post_title . ' (' . $locale . ')', 'post_author' => $post->post_author, 'meta_input' => ['_everylocale_source_id' => $id, '_everylocale_locale' => $locale]], true);
                if (is_wp_error($draft)) { self::error($id, $draft); continue; }
                $existing[$locale] = get_post($draft);
            }
            $exports = [];
            foreach (['metadata', 'content'] as $part) {
                $response = self::request('/documents/' . rawurlencode(self::namespace($id, $part)) . '/export/' . rawurlencode($locale));
                if (is_wp_error($response)) { $waiting = true; continue 2; }
                if (($response['sourceRevision'] ?? '') !== $state['documents'][$part]) { $waiting = true; continue 2; }
                $exports[$part] = $response;
            }
            $approval = hash('sha256', $exports['metadata']['revision'] . ':' . $exports['content']['revision']);
            if ($existing[$locale]->post_status === 'publish' && get_post_meta($existing[$locale]->ID, '_everylocale_approval_revision', true) === $approval) { continue; }
            $current = get_post($id);
            if (!$current || $current->post_status !== 'publish' || self::source_revision($current) !== $revision) { self::schedule($id); return; }
            // Approval is enforced remotely. Publishing still requires the original author's WordPress capability.
            if (!user_can($post->post_author, 'publish_posts')) { self::error($id, new WP_Error('everylocale_permission', 'The source author cannot publish translations.')); return; }
            $metadata = json_decode($exports['metadata']['content'], true);
            if (!is_array($metadata) || !isset($metadata['title'])) { self::error($id, new WP_Error('everylocale_metadata', 'Invalid approved metadata.')); return; }
            $previousSlug = $existing[$locale]->post_name;
            $slug = sanitize_title($metadata['slug'] ?? $metadata['title']);
            $updated = wp_update_post(['ID' => $existing[$locale]->ID, 'post_title' => sanitize_text_field($metadata['title']), 'post_excerpt' => wp_kses_post($metadata['excerpt'] ?? ''), 'post_content' => wp_kses_post($exports['content']['content']), 'post_name' => $slug, 'post_status' => 'publish', 'meta_input' => ['_everylocale_source_revision' => $revision, '_everylocale_approval_revision' => $approval]], true);
            if (is_wp_error($updated)) { self::error($id, $updated); continue; }
            if ($previousSlug && $previousSlug !== $slug) { add_post_meta($updated, '_wp_old_slug', $previousSlug); }
            foreach ($metadata['seo'] ?? [] as $key => $value) {
                if (array_key_exists($key, self::metadata($post)['seo'])) { update_post_meta($updated, $key, sanitize_text_field($value)); }
            }
            foreach (['categories' => 'category', 'tags' => 'post_tag'] as $field => $taxonomy) {
                $terms = [];
                foreach ($metadata[$field] ?? [] as $sourceTerm => $name) {
                    $term = term_exists($name, $taxonomy);
                    if (!$term) { $term = wp_insert_term($name, $taxonomy, ['slug' => sanitize_title($name) . '-' . self::prefix($locale)]); }
                    if (!is_wp_error($term)) { $terms[] = (int) (is_array($term) ? $term['term_id'] : $term); }
                }
                wp_set_post_terms($updated, $terms, $taxonomy);
            }
            do_action('everylocale_translation_published', $updated, $id, $locale, $revision);
        }
        delete_post_meta($id, '_everylocale_error');
        self::schedule($id, $waiting ? 120 : 300);
    }
    private static function error(int $id, WP_Error $error): void { update_post_meta($id, '_everylocale_error', $error->get_error_message()); self::schedule($id, 120); }
    public static function rewrites(): void {
        add_rewrite_rule('^everylocale-sitemap\\.xml$', 'index.php?el_sitemap=index', 'top');
        add_rewrite_rule('^everylocale-sitemap-([0-9]+)\\.xml$', 'index.php?el_sitemap=$matches[1]', 'top');
        foreach (self::locales() as $locale) { $prefix = preg_quote(self::prefix($locale), '/'); add_rewrite_rule('^' . $prefix . '/([^/]+)/?$', 'index.php?el_locale=' . rawurlencode($locale) . '&name=$matches[1]', 'top'); }
        if (get_option('everylocale_flush_rewrites')) { delete_option('everylocale_flush_rewrites'); flush_rewrite_rules(false); }
    }
    /** REST consumers and crawlers see the same approved, enabled locale boundaries as pages. */
    public static function rest_query(array $args, WP_REST_Request $request): array {
        $locale = $request->get_param('el_locale') ?: self::config()['source_locale'];
        $localeQuery = $locale === self::config()['source_locale']
            ? ['key' => '_everylocale_source_id', 'compare' => 'NOT EXISTS']
            : ['relation' => 'AND', ['key' => '_everylocale_locale', 'value' => $locale], ['key' => '_everylocale_approval_revision', 'compare' => 'EXISTS']];
        $args['meta_query'] = ['relation' => 'AND', (array) ($args['meta_query'] ?? []), $localeQuery];
        return $args;
    }
    public static function sitemap_query(array $args): array {
        $args['meta_query'] = ['relation' => 'AND', (array) ($args['meta_query'] ?? []), ['relation' => 'OR', ['key' => '_everylocale_source_id', 'compare' => 'NOT EXISTS'], ['relation' => 'AND', ['key' => '_everylocale_locale', 'value' => self::locales(), 'compare' => 'IN'], ['key' => '_everylocale_approval_revision', 'compare' => 'EXISTS']]]];
        return $args;
    }
    public static function sitemap(): void {
        $page = get_query_var('el_sitemap'); if (!$page) { return; }
        $query = new WP_Query(['post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => 100, 'paged' => $page === 'index' ? 1 : max(1, (int) $page), 'fields' => 'ids', 'meta_query' => [['key' => '_everylocale_source_id', 'compare' => 'NOT EXISTS']]]);
        if ($page !== 'index' && (!ctype_digit((string) $page) || (int) $page < 1 || (int) $page > max(1, $query->max_num_pages))) { status_header(404); return; }
        status_header(200); header('Content-Type: application/xml; charset=UTF-8');
        $xml = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
        echo '<?xml version="1.0" encoding="UTF-8"?>';
        if ($page === 'index') {
            echo '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
            for ($index = 1; $index <= max(1, $query->max_num_pages); $index++) { echo '<sitemap><loc>' . $xml(home_url('/everylocale-sitemap-' . $index . '.xml')) . '</loc></sitemap>'; }
            echo '</sitemapindex>';
        } else {
            echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';
            foreach ($query->posts as $sourceId) {
                $group = self::group((int) $sourceId);
                foreach ($group as $url) {
                    echo '<url><loc>' . $xml($url) . '</loc>';
                    foreach ($group as $locale => $alternate) { echo '<xhtml:link rel="alternate" hreflang="' . $xml($locale) . '" href="' . $xml($alternate) . '"/>'; }
                    echo '<xhtml:link rel="alternate" hreflang="x-default" href="' . $xml(reset($group)) . '"/></url>';
                }
            }
            echo '</urlset>';
        }
        exit;
    }
    public static function unavailable(): void {
        if (!is_404() || !get_query_var('el_locale')) { return; }
        $post = get_page_by_path((string) get_query_var('name'), OBJECT, 'post');
        $sourceId = $post ? ((int) get_post_meta($post->ID, '_everylocale_source_id', true) ?: $post->ID) : 0;
        $source = $sourceId ? get_post($sourceId) : null;
        status_header(404); header('Content-Type: text/html; charset=UTF-8');
        echo '<!doctype html><html lang="en"><meta charset="UTF-8"><title>Translation unavailable</title><main><h1>This translation is not available yet.</h1>';
        if ($source && $source->post_status === 'publish') { echo '<a href="' . esc_url(get_permalink($source)) . '">Read the original article</a>'; }
        else { echo '<a href="' . esc_url(home_url('/')) . '">Browse original articles</a>'; }
        echo '</main></html>'; exit;
    }
    public static function filter_query(WP_Query $query): void {
        if (is_admin() || !$query->is_main_query()) { return; }
        $locale = $query->get('el_locale');
        if ($locale) {
            if (!in_array($locale, self::locales(), true)) { $query->set('post__in', [0]); return; }
            $query->set('meta_query', ['relation' => 'AND', (array) $query->get('meta_query'), ['key' => '_everylocale_locale', 'value' => $locale]]);
        } elseif ($query->is_home() || $query->is_archive()) {
            $query->set('meta_query', ['relation' => 'AND', (array) $query->get('meta_query'), ['key' => '_everylocale_source_id', 'compare' => 'NOT EXISTS']]);
        }
    }
    public static function permalink(string $url, WP_Post $post): string {
        $locale = get_post_meta($post->ID, '_everylocale_locale', true);
        return $locale && get_post_meta($post->ID, '_everylocale_source_id', true) ? home_url('/' . self::prefix($locale) . '/' . $post->post_name . '/') : $url;
    }
    public static function redirect_old_slug(): void {
        $locale = get_query_var('el_locale');
        if (!is_404() || !in_array($locale, self::locales(), true)) { return; }
        $slug = get_query_var('name');
        $posts = get_posts(['post_type' => 'post', 'post_status' => 'publish', 'numberposts' => 1, 'meta_query' => ['relation' => 'AND', ['key' => '_everylocale_locale', 'value' => $locale], ['key' => '_wp_old_slug', 'value' => $slug]]]);
        if ($posts) { wp_safe_redirect(get_permalink($posts[0]), 301); exit; }
    }
    public static function language_attributes(string $attributes): string {
        if (!is_singular('post')) { return $attributes; }
        $locale = get_post_meta(get_queried_object_id(), '_everylocale_locale', true) ?: self::config()['source_locale'];
        return 'lang="' . esc_attr($locale) . '" dir="' . (str_starts_with($locale, 'ar') ? 'rtl' : 'ltr') . '"';
    }
    private static function group(int $sourceId): array {
        $source = get_post($sourceId); if (!$source || $source->post_status !== 'publish') { return []; }
        $group = [self::config()['source_locale'] => get_permalink($source)];
        foreach (self::translations($sourceId) as $post) {
            $locale = get_post_meta($post->ID, '_everylocale_locale', true);
            if ($post->post_status === 'publish' && get_post_meta($post->ID, '_everylocale_approval_revision', true) && in_array($locale, self::locales(), true)) { $group[$locale] = get_permalink($post); }
        }
        return $group;
    }
    private static function published_group(): array {
        if (!is_singular('post')) { return []; }
        $current = get_queried_object_id();
        return self::group((int) get_post_meta($current, '_everylocale_source_id', true) ?: $current);
    }
    public static function alternate_links(): void {
        $group = self::published_group();
        foreach ($group as $locale => $url) { echo '<link rel="alternate" hreflang="' . esc_attr($locale) . '" href="' . esc_url($url) . '" />' . "\n"; }
        if ($group) { echo '<link rel="alternate" hreflang="x-default" href="' . esc_url(reset($group)) . '" />' . "\n"; }
    }
    public static function switcher(): string {
        $names = ['en' => 'English', 'ar' => 'العربية', 'zh-Hant-TW' => '繁體中文 (台灣)', 'de' => 'Deutsch', 'es' => 'Español', 'fr' => 'Français'];
        $links = []; foreach (self::published_group() as $locale => $url) { $links[] = '<a href="' . esc_url($url) . '" lang="' . esc_attr($locale) . '">' . esc_html($names[$locale] ?? $locale) . '</a>'; }
        return $links ? '<nav aria-label="Language">' . implode(' ', $links) . '</nav>' : '';
    }
    /** Only published same-site counterparts replace protected source links at render time. */
    public static function localized_links(string $content, ?WP_Post $post = null): string {
        $post = $post ?: get_post(); if (!$post) { return $content; }
        $locale = get_post_meta($post->ID, '_everylocale_locale', true);
        if (!in_array($locale, self::locales(), true)) { return $content; }
        $site = wp_parse_url(home_url('/')); $processor = new WP_HTML_Tag_Processor($content);
        while ($processor->next_tag('a')) {
            $href = $processor->get_attribute('href'); if (!is_string($href) || str_starts_with($href, '#')) { continue; }
            $url = str_starts_with($href, '/') && !str_starts_with($href, '//') ? home_url($href) : $href;
            $parts = wp_parse_url($url);
            if (!$parts || ($parts['scheme'] ?? '') !== ($site['scheme'] ?? '') || ($parts['host'] ?? '') !== ($site['host'] ?? '') || ($parts['port'] ?? null) !== ($site['port'] ?? null)) { continue; }
            $targetId = url_to_postid($url); if (!$targetId) { continue; }
            $sourceId = (int) get_post_meta($targetId, '_everylocale_source_id', true) ?: $targetId;
            $group = self::group($sourceId); if (!isset($group[$locale])) { continue; }
            $query = []; parse_str($parts['query'] ?? '', $query);
            foreach (['p', 'page_id', 'name', 'el_locale', 'post_type'] as $routingKey) { unset($query[$routingKey]); }
            $localized = $query ? add_query_arg($query, $group[$locale]) : $group[$locale];
            if (isset($parts['fragment'])) { $localized .= '#' . $parts['fragment']; }
            $processor->set_attribute('href', $localized);
        }
        return $processor->get_updated_html();
    }
}
