# EveryLocale for WordPress

This adapter connects WordPress 6.4+ / PHP 8.0+ to the standalone service.
It does not contain model credentials or translation business logic.

1. Install the `everylocale/` directory as a plugin and activate it.
2. Create a workspace project with matching source and target locales. Choose automatic approval or a human review gate in project settings.
3. Issue a token with `read`, `import`, `translate`, and `export`, with a finite
   expiry. Do not grant the connector `approve`.
4. Open Settings -> EveryLocale and save the service URL, project, and token.
5. Publish or update an original post. Automatic mode accepts clean validated and AI-reviewed translations. Human mode waits for workspace approval; material findings stay in Review in either mode.
6. The WordPress cron checks approved exports and publishes complete articles.
   Use a real system cron invoking WP-Cron for reliable background processing.

Metadata, article HTML, image alt text, SEO title/description (Yoast/Rank Math),
and category/tag names are imported. Add SEO field keys with the
`everylocale_metadata_fields` filter. Canonical URLs are not copied from the
source language. Original URLs remain unchanged; translated posts use a
language prefix. The shortcode `[everylocale_switcher]` lists published
alternatives. No browser or country redirect is performed.

`/everylocale-sitemap.xml` is the paginated localized sitemap index. Its article
entries include reciprocal language alternates and an original-language
`x-default`. Drafts and disabled target languages are excluded. The native
WordPress sitemap also excludes unapproved or disabled translations.
REST post collections default to original-language posts; pass `el_locale=fr`
(or another configured locale) to fetch that language's approved posts.
Unavailable prefixed article URLs return 404 with an original-language link.

Publishing requires the source author's `publish_posts` capability. Source
withdrawal makes linked translations drafts immediately and withdraws their
translation units. Source edits keep old approved posts live until every
current segment is approved. Draft translations never appear in alternate
links. Last sync errors are recorded in `_everylocale_error` on the source.

The connector polls already published articles every five minutes so newly
approved corrections are delivered even when the English source has not changed.
Old approved slugs redirect permanently. Withdrawal delivery is retained in
WordPress options and retried after service outages, including deletion of the
original post. A reliable cron is required for these delivery guarantees.

The administrator explicitly selects the endpoint, including private networks.
Requests disallow redirects and verify HTTPS certificates. Protect the saved
connector token as a WordPress secret; rotate it in the workspace and update
the setting. The workspace provider keys never enter WordPress.

Deactivation stops the sync hook and removes active rewrite rules. Data is
preserved. To uninstall permanently, first export needed translations, revoke
the connector token, deactivate the plugin, and remove its directory. This
does not delete posts or metadata.
