import arenaSpaceVideo from "../../assets/arena-space.mp4";
import arenaSpacePoster from "../../assets/arena-space.jpg";

export function ArenaBackdrop({
  src = arenaSpaceVideo,
  className = "rps-arena__backdrop",
}: {
  src?: string;
  className?: string;
} = {}) {
  return (
    <video
      className={className}
      src={src}
      poster={arenaSpacePoster}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden
    />
  );
}
