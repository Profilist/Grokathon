# Grok Play Feed Demo

A Chrome extension prototype that attaches playable 3D games to marked posts in the X feed. It supports the original two-player Rock Paper Scissors arena and a four-human Taiwanese 16-tile Mahjong table powered by Supabase Realtime and an authoritative Edge Function.

## 1. Configure Supabase

Create a Supabase project, then:

1. Open **Authentication → Providers → Anonymous Sign-Ins** and enable anonymous sign-ins.
2. Apply the migrations in [`supabase/migrations`](supabase/migrations) in filename order.
3. Deploy the authoritative Mahjong function:

```bash
supabase functions deploy mahjong-game
```

Keep JWT verification enabled. The function receives the service-role key from Supabase's server-side environment; never add it to `.env` or the extension.

4. Copy the environment template:

```bash
cp .env.example .env
```

5. Fill in the project URL and publishable key from **Project Settings → API**:

```dotenv
WXT_SUPABASE_URL=https://your-project.supabase.co
WXT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

The publishable key is designed for browser clients. Database access is protected by the migration's Row Level Security policies; never put a Supabase service-role key in the extension.

## 2. Build and install

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
.output/chrome-mv3
```

After rebuilding, click the extension's **Reload** button on `chrome://extensions`. Both players must build with the same Supabase project configuration.

For development, `pnpm dev` opens a separate Chrome profile with the extension installed automatically.

## 3. Rock Paper Scissors

The host publishes an X post with a unique game marker:

```text
Does anyone want to play Rock Paper Scissors for $5?

[grokplay:rps-8f3k]
```

Use a new game ID for each lobby. IDs may contain letters, numbers, underscores, and hyphens.

1. While signed into the posting X account, the host views their own marked post. Their extension creates the Supabase lobby automatically.
2. The teammate views the same post with the extension installed.
3. The teammate clicks **Join game**.
4. Both embedded cards update to **Choose your move** through Supabase Realtime.
5. Each player picks an animated 3D Rock, Paper, or Scissors piece. Choices stay hidden until both players lock in.
6. Both Three.js arenas reveal the moves and winner at the same time.

The extension uses Supabase anonymous authentication to give each installation a persistent player identity. This is a single-round concept game: there is no email, X OAuth, best-of-three scoring, wager, or real payment yet.

## 4. Four-player 3D Mahjong

Publish a separate marker for Mahjong:

```text
Four seats open. Who wants to play Mahjong?

[grokplay:mahjong:mahjong-8f3k]
```

1. The post author views their own post to create seat zero.
2. Three other extension installations or Chrome profiles click **Join table**.
3. Once four seats are occupied, any seated player can click **Deal tiles**.
4. The active player clicks a tile in their hand to discard. Chow, pong, kong, win, and pass controls appear only when legal.
5. Turns expire after 30 seconds and use the baseline legal-play bot. Claim windows expire after 10 seconds and unanswered claims pass.
6. At the end, all four hands are revealed, seats one through three reopen, and any seated player can start the next hand once the table refills.

Opponent hands, the wall order, pending claims, and the deterministic seed are stored only in the private server state. Realtime publishes lobby summaries and sanitized events.

## Troubleshooting

- **Supabase setup required:** create `.env`, rebuild, and reload the extension.
- **Enable anonymous sign-ins:** enable the provider in Supabase Auth settings.
- **Run the included migration:** execute the SQL migration in the Supabase SQL Editor.
- **Waiting for the host:** the author must view their own post first while signed into the account that published it.
- **Lobby already full:** use a fresh game ID in a new marker post.
- **Run the RPS round migration:** apply every migration in filename order if the lobby works but move submission fails.
- **Deploy the Mahjong function:** run `supabase functions deploy mahjong-game` if the Mahjong card reports that its server is unavailable.
- **Table looks compact:** join a seat or click **Open table**; the Mahjong iframe expands inside the post without opening a new page.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

The extension reads only visible post markup needed to find the marker, theme, post author, and signed-in profile handle. It does not read X cookies or use the X API.

Mahjong code and tile-art licensing are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
