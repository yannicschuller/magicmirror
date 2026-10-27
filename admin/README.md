# Admin panel

React + TypeScript + Vite + Tailwind CSS v4 with [shadcn/ui](https://ui.shadcn.com) components
(`src/components/ui`, added via the shadcn CLI – see `components.json`).
Form schemas, defaults and translations come from `../public/shared/` and are bundled into the build.

```sh
npm ci
npm run dev        # http://localhost:5173/admin/ – proxies /api, /auth, /login, /brand, /vendor,
                   # /shared, /go2rtc and the mirror (/) to the server on http://localhost:8080
                   # (override with MM_BACKEND=http://host:port)
npm run build      # type-check + build into ../public/admin (served by the server at /admin/)
npm run typecheck
```

Sign in once through the proxied `/login` (the session cookie is then valid for the dev server).
`public/admin/` is build output and not committed; the Dockerfile builds it in a separate stage.
When running the server from source (or with `./public` mounted into the container), run
`npm run build` here first.

Add more shadcn components with `npx shadcn@4.23.0 add <name>`.
UI strings go through `t()`; German translations live in `../public/shared/locales/de/admin.js`.
