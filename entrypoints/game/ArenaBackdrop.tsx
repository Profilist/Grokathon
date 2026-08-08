import arenaSpaceVideo from "../../assets/arena-space.mp4";
import arenaSpacePoster from "../../assets/arena-space.jpg";

export function ArenaBackdrop() {
  return (
    <video
      className="rps-arena__backdrop"
      src={arenaSpaceVideo}
      poster={arenaSpacePoster}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden
    />
  );
}
