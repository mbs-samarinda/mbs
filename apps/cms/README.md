# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

The script runs `strapi ts:generate-types` first, and that is load-bearing — do
not drop it. `types/generated/` is gitignored, and it is what gives
`api::page.page` and the rest their real shapes. On a developer's machine those
files already exist because `strapi develop` writes them on boot, so anything
typed against them compiles locally and fails in CI, where the directory does
not exist at all. Generating them as the first build step makes both
environments identical. It reads the schema files only and never queries the
database, so it works on a fresh clone with nothing running. It does still load
the database driver, which is why `config/database.ts` defaults to postgres:
sqlite is not installed and a missing `.env` would otherwise crash the build.

## Changing a schema

Bootstrap (`src/index.ts`) only adds content: seeds create rows that are
missing, and `backfillOnce` repairs rows that exist. Renaming a field or
changing its type goes in `database/migrations`. Strapi syncs the schema
before bootstrap runs and drops the old column, so a backfill that copies the
old values runs too late and finds nothing. Migrations run before that sync.

Permissions are code too. The editor role and the Public role's content
grants are rebuilt from `src/owner-scope.ts` and `PUBLIC_READ` on every boot,
so a change made to either in the admin panel is reverted on the next start.

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
