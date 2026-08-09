# Grok Play Feed Demo

A Chrome extension prototype that attaches playable 3D games to marked posts in the X feed. It supports the original two-player Rock Paper Scissors arena and a four-human Taiwanese 16-tile Mahjong table powered by Supabase Realtime and an authoritative Edge Function.

Use a game marker to render an embedded card:

| Marker | Card |
| --- | --- |
| `[grokplay:<id>]` | Shared lobby: choose a game and wager, then play |

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

## 3. Create a game

The host publishes an X post with one unique lobby marker:

```text
Who wants to play?

[grokplay:friday-8f3k]
```

Use a new lobby ID each time. IDs may contain letters, numbers, underscores, and hyphens.

1. While signed into the posting X account, the host views their own marked post.
2. The host chooses **RPS** or **Mahjong**, enters a concept wager amount, and creates the game.
3. Supabase binds that lobby ID to the selected game and wager. Everyone viewing the post transitions to the chosen game through Realtime.
4. Other players join and play using the game-specific controls.

The extension uses Supabase anonymous authentication to give each installation a persistent player identity. Wagers are display metadata only: there is no email, X OAuth, X Money integration, escrow, or real payment yet.

### Rock Paper Scissors

After the host selects RPS, the teammate clicks **Join game**. Both embedded cards update through Supabase Realtime. Each player picks an animated 3D Rock, Paper, or Scissors piece; choices stay hidden until both players lock in, then both arenas reveal the moves and winner.

## 4. Four-player 3D Mahjong

Choose Mahjong from the setup screen attached to the same generic lobby marker:

```text
Four seats open. Who wants to play Mahjong?

[grokplay:friday-8f3k]
```

1. The post author views their own post to create seat zero.
2. Either three other extension installations or Chrome profiles click **Join table**, or the host clicks **Fill with bots** for a solo test.
3. Once four seats are occupied, any seated player can click **Deal tiles**.
4. The active player clicks a tile in their hand to discard. Chow, pong, kong, win, and pass controls appear only when legal.
5. Turns expire after 30 seconds and use the baseline legal-play bot. Claim windows expire after 10 seconds and unanswered claims pass.
6. At the end, all four hands are revealed, seats one through three reopen, and any seated player can start the next hand once the table refills.

Opponent hands, the wall order, pending claims, and the deterministic seed are stored only in the private server state. Realtime publishes lobby summaries and sanitized events.

Legacy explicit markers such as `[grokplay:mahjong:table_12]` still work and preselect Mahjong when the lobby has not been configured yet.

## 5. Spectate a game

Once an RPS lobby is full, anyone who is not one of its two players automatically sees the regular 3D gameplay arena in read-only mode. Spectators have no join, move, replay, or betting controls, and there is no separate chat interface. Moves remain hidden until both players lock in.

## Troubleshooting

- **Supabase setup required:** create `.env`, rebuild, and reload the extension.
- **Enable anonymous sign-ins:** enable the provider in Supabase Auth settings.
- **Run the included migration:** execute the SQL migration in the Supabase SQL Editor.
- **Waiting for the host:** the author must view their own post first while signed into the account that published it.
- **Lobby already full:** use a fresh game ID in a new marker post.
- **Testing alone:** the host can click **Fill with bots**, then **Deal tiles**, without creating extra Chrome profiles.
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
