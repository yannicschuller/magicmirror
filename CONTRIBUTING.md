# Contributing

Thanks for helping! Bug reports, translations, new modules and fixes are all welcome.

## Getting started

```bash
git clone https://github.com/yannicschuller/magicmirror.git
cd magicmirror
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- Mirror: http://localhost:8080 · Admin: http://localhost:8080/admin
- The dev setup includes a mock OIDC server (any username works) and mounts `src/` and `public/` into the container. Restart the `magicmirror` container after server changes.
- Run the tests with `npm test` (or `docker run --rm -v "$PWD":/app -w /app node:22-bookworm-slim npm test`).

## Guidelines

- **Keep the Pi 3 in mind.** The mirror front end is plain JavaScript on purpose: no frameworks, few timers, no heavy animations.
- **Every user-facing string goes through `t()`.** The English text is the message id. Add the German translation to `public/shared/locales/de/` (`schema.js` for module settings, `mirror.js`, `server.js`, `admin.js`, `auth.js`). `npm test` fails if a schema string has no translation.
- **No secrets in the repository.** Configuration lives in `.env` and `./data`, and both are git-ignored. Fields marked `secret: true` in the schema are never sent to the mirror.
- **New module** (plug-in, see `news` as an example):
  1. schema in `public/shared/modules/<type>.js` and registered in `public/shared/modules/index.js`
  2. renderer `public/mirror/modules/<type>.js` + `<type>.css`, registered in `public/mirror/modules/index.js` and linked in `public/mirror/index.html`
  3. optional provider `src/providers/<type>.js` (export `provider`, register it in `src/server.js`)
  4. German strings in `public/shared/locales/de/modules/<type>.js` (imported in `locales/de/index.js`)
  5. a test for parsing/logic with fixtures (no live network)
- Only use the existing field types – the admin forms are generated from them.
- Match the existing code style: 2-space indent, single quotes, small functions, and comments only where something is not obvious.
- Use one topic per pull request, and describe how you tested it.

## Translations

Want to add another language? Copy `public/shared/locales/de/` to `locales/<code>/`, translate the values and register the language in `public/shared/i18n.js` (`DICTS` and `LANGUAGES`). Then add a matching locale option to `GENERAL_FIELDS` in `modules.js`.

## Releases

Maintainers tag releases as `vX.Y.Z`. The CI workflow then publishes `ghcr.io/yannicschuller/magicmirror{,-kiosk,-updater}` for amd64, arm64 and arm/v7.
