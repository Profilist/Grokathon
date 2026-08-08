interface GameCardProps {
  gameId: string;
  hostHandle: string;
  theme: "light" | "dark";
}

function Avatar({ label, waiting = false }: { label: string; waiting?: boolean }) {
  return (
    <div className={`avatar${waiting ? " avatar--waiting" : ""}`} aria-hidden>
      {waiting ? "?" : label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function GameCard({ gameId, hostHandle, theme }: GameCardProps) {
  return (
    <main className="page" data-theme={theme}>
      <section className="game-card" aria-label="Rock Paper Scissors lobby">
        <header className="game-card__header">
          <div className="brand">
            <span className="brand__mark" aria-hidden>
              ✦
            </span>
            <div>
              <div className="brand__name">Grok Play</div>
              <div className="brand__meta">Game #{gameId}</div>
            </div>
          </div>
          <span className="wager-badge">Demo · $5 wager</span>
        </header>

        <div className="title-row">
          <div>
            <p className="eyebrow">HEAD-TO-HEAD</p>
            <h1>Rock Paper Scissors</h1>
          </div>
          <div className="lobby-status">
            <span className="lobby-status__dot" />
            Lobby open
          </div>
        </div>

        <div className="players">
          <div className="player">
            <Avatar label={hostHandle} />
            <strong>@{hostHandle.replace(/^@/, "")}</strong>
            <span>Host</span>
          </div>

          <div className="versus" aria-label="versus">
            VS
          </div>

          <div className="player player--waiting">
            <Avatar label="" waiting />
            <strong>Waiting…</strong>
            <span>1 seat open</span>
          </div>
        </div>

        <footer className="game-card__footer">
          <div className="rules">
            <span>Best of 3</span>
            <span>Winner takes $10</span>
          </div>
          <button type="button" disabled aria-disabled="true" title="Interaction comes next">
            Join game
          </button>
        </footer>

        <p className="prototype-note">Visual prototype only · No money is moved</p>
      </section>
    </main>
  );
}
