import type { Slide } from "../lib/types";
export function SlideView({
  slide,
  small = false,
}: {
  slide: Slide;
  small?: boolean;
}) {
  if (slide.image)
    return (
      <div className={`slide-surface pdf-slide ${small ? "small" : ""}`}>
        <img src={slide.image} alt={slide.title} draggable="false" />
      </div>
    );
  return (
    <article className={`slide-surface demo-slide ${small ? "small" : ""}`}>
      <span className="slide-eyebrow">{slide.eyebrow}</span>
      <h1>{slide.title}</h1>
      <p>{slide.body}</p>
      {slide.items && (
        <div className="slide-items">
          {slide.items.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
      <div className="slide-footer">
        <span>AxiomPitch</span>
        <span>MOVE YOUR STORY FORWARD</span>
      </div>
    </article>
  );
}
