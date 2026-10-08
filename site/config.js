/*
 * Which backend this portal calls — written by whoever deploys it.
 *
 * A deployment that serves the portal and Odoo under one hostname answers this
 * file with the page's own origin (see nginx.conf), so the link to share is the
 * plain URL: no ?api= for a client to copy and no 127.0.0.1 to get wrong.
 *
 * This is the placeholder that ships with the build, and it names nothing on
 * purpose: a static host with no Odoo behind it (GitHub Pages) keeps falling
 * back as before and runs the offline sample.
 *
 *   window.SMARTSPEND_API = 'https://smartspend-demo.example.com';
 */
